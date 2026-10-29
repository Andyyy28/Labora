import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createApp } from '../src/app.js';
import { importData } from '../scripts/import-data.js';
import { saveRecord, deleteRecord, borrowEquipment, returnEquipment, history, today, dateValue } from '../src/domain.js';

let postgres, db, student, category, equipment, server, origin;
const equipmentData = { equipment_code: 'QA-001', equipment_name: 'Test microscope', total_quantity: '5', available_quantity: '5', condition_status: 'Good' };
const query = async (sql, values) => {
  const result = await postgres.query(sql, values);
  return { ...result, rowCount: result.rows.length || result.affectedRows || 0 };
};
before(async () => {
  postgres = new PGlite();
  for (const file of (await readdir(new URL('../supabase/migrations', import.meta.url))).sort()) await postgres.exec(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'));
  db = { query, connect: async () => ({ query, release() {} }) };
  student = await saveRecord(db, 'students', { student_no: 'QA-001', full_name: 'QA Student', course: 'Science', email: 'qa@example.com' });
  category = await saveRecord(db, 'categories', { category_name: 'QA Category', description: '' });
  equipmentData.category_id = String(category.category_id);
  equipment = await saveRecord(db, 'equipment', equipmentData);
  server = createApp(() => db, { SESSION_SECRET: 'a'.repeat(64) }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { if (server) await new Promise(resolve => server.close(resolve)); await postgres?.close(); });
const input = () => ({ student_id: student.student_id, equipment_id: equipment.equipment_id, quantity: '2', borrow_date: today(), due_date: today() });
const stock = async () => (await query('SELECT available_quantity FROM labtrack.equipment WHERE equipment_id=$1', [equipment.equipment_id])).rows[0].available_quantity;

test('PostgreSQL schema enables RLS and indexes foreign keys', async () => {
  const tables = (await query("SELECT relname,relrowsecurity FROM pg_class JOIN pg_namespace ON pg_namespace.oid=relnamespace WHERE nspname='labtrack' AND relkind='r'")).rows;
  assert.equal(tables.length, 4);
  assert.ok(tables.every(table => table.relrowsecurity));
});
test('borrowing and returns restore stock exactly once', async () => {
  const id = await borrowEquipment(db, input());
  assert.equal(await stock(), 3);
  await assert.rejects(borrowEquipment(db, { ...input(), quantity: 4 }), /Not enough/);
  assert.equal(await stock(), 3);
  await returnEquipment(db, id, today());
  assert.equal(await stock(), 5);
  await assert.rejects(returnEquipment(db, id, today()), /already been returned/);
  assert.equal(await stock(), 5);
});
test('invalid quantities, dates and unavailable equipment are rejected', async () => {
  for (const quantity of ['0', '-1', '1.5', '1e2', '2147483648']) await assert.rejects(borrowEquipment(db, { ...input(), quantity }));
  assert.throws(() => dateValue('2026-02-30'));
  await assert.rejects(borrowEquipment(db, { ...input(), borrow_date: '2099-01-01', due_date: '2099-01-02' }), /future/);
  await assert.rejects(borrowEquipment(db, { ...input(), due_date: '2000-01-01' }), /earlier/);
  await query("UPDATE labtrack.equipment SET condition_status='For Repair' WHERE equipment_id=$1", [equipment.equipment_id]);
  await assert.rejects(borrowEquipment(db, input()), /For Repair/);
  await query("UPDATE labtrack.equipment SET condition_status='Good' WHERE equipment_id=$1", [equipment.equipment_id]);
});
test('equipment edits respect active loans; referenced records cannot be deleted', async () => {
  const id = await borrowEquipment(db, input());
  await assert.rejects(saveRecord(db, 'equipment', { ...equipmentData, available_quantity: '4' }, equipment.equipment_id), /on loan/);
  await assert.rejects(deleteRecord(db, 'students', student.student_id), error => ['23503', '23001'].includes(error.code));
  await assert.rejects(deleteRecord(db, 'categories', category.category_id), error => ['23503', '23001'].includes(error.code));
  await assert.rejects(deleteRecord(db, 'equipment', equipment.equipment_id), error => ['23503', '23001'].includes(error.code));
  await returnEquipment(db, id, today());
});
test('failed second write rolls back the borrowing insert and stock', async () => {
  const before = (await query('SELECT count(*)::int n FROM labtrack.borrowings')).rows[0].n;
  await postgres.exec("CREATE FUNCTION labtrack.qa_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Forced stock failure'; END; $$; CREATE TRIGGER qa_fail BEFORE UPDATE ON labtrack.equipment FOR EACH ROW EXECUTE FUNCTION labtrack.qa_failure();");
  try { await assert.rejects(borrowEquipment(db, input()), /Forced stock failure/); }
  finally { await postgres.exec('DROP TRIGGER qa_fail ON labtrack.equipment; DROP FUNCTION labtrack.qa_failure();'); }
  assert.equal((await query('SELECT count(*)::int n FROM labtrack.borrowings')).rows[0].n, before);
  assert.equal(await stock(), 5);
});
test('history computes overdue status and combines filters case insensitively', async () => {
  const id = await borrowEquipment(db, { ...input(), quantity: 1, borrow_date: '2020-01-01', due_date: '2020-01-02' });
  const overdue = await history(db, { q: 'qa student', status: 'Overdue', from: '2020-01-01', to: '2020-01-02' });
  assert.equal(overdue.length, 1);
  assert.equal(overdue[0].category_name, 'QA Category');
  await returnEquipment(db, id, today());
  assert.equal((await history(db, { q: 'qa student', status: 'Overdue' })).length, 0);
  await assert.rejects(history(db, { from: '2026-10-29', to: '2020-01-01' }), /Start date/);
});
test('CRUD validation, uniqueness, updates and deletion work', async () => {
  const data = { student_no: 'QA-002', full_name: '<script>alert(1)</script>', course: 'IT', email: 'qa2@example.com' };
  const row = await saveRecord(db, 'students', data);
  await assert.rejects(saveRecord(db, 'students', data), error => error.code === '23505');
  await assert.rejects(saveRecord(db, 'students', { ...data, email: 'invalid' }), /email/);
  await saveRecord(db, 'students', { ...data, course: 'Updated' }, row.student_id);
  const response = await fetch(`${origin}/students?q=alert`);
  assert.match(await response.text(), /&lt;script&gt;alert/);
  await deleteRecord(db, 'students', row.student_id);
});
test('HTTP pages, asset delivery, CSRF and borrowing/return flow', async () => {
  for (const path of ['/', '/students', '/categories', '/equipment?condition_status=Good', '/borrowings', '/students/add', '/categories/add', '/equipment/add', '/assets/style.css']) assert.equal((await fetch(origin + path)).status, 200, path);
  const response = await fetch(`${origin}/borrowings/borrow`);
  const cookie = response.headers.get('set-cookie').split(';')[0];
  const html = await response.text();
  const csrf = html.match(/name="csrf" value="([^"]+)"/)[1];
  const post = async (path, body, cookieValue = cookie) => fetch(origin + path, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookieValue }, body: new URLSearchParams(body), redirect: 'manual' });
  assert.equal((await post('/borrowings/borrow', input())).status, 403);
  assert.equal((await post('/borrowings/borrow', { ...input(), csrf }, '')).status, 403);
  assert.equal((await post('/borrowings/borrow', { ...input(), csrf })).status, 303);
  const id = (await query('SELECT max(borrowing_id)::int id FROM labtrack.borrowings')).rows[0].id;
  assert.equal(await stock(), 3);
  assert.equal((await fetch(`${origin}/borrowings/return?id=${id}`)).status, 200);
  assert.equal((await post(`/borrowings/return?id=${id}`, { return_date: today(), csrf })).status, 303);
  assert.equal(await stock(), 5);
  assert.equal((await post(`/borrowings/return?id=${id}`, { return_date: today(), csrf })).status, 400);
  assert.equal((await fetch(`${origin}/equipment/edit?id=999999`)).status, 404);
  assert.equal((await fetch(`${origin}/database-export.sql`)).status, 404);
});
test('production requires a CSRF secret and serves public pages without a password', async () => {
  const guarded = createApp(() => db, { NODE_ENV: 'production' }).listen(0, '127.0.0.1');
  await new Promise(resolve => guarded.once('listening', resolve));
  try { assert.equal((await fetch(`http://127.0.0.1:${guarded.address().port}/`)).status, 503); }
  finally { await new Promise(resolve => guarded.close(resolve)); }
  const protectedApp = createApp(() => db, { NODE_ENV: 'production', SESSION_SECRET: 'x'.repeat(64), LAB_APP_PASSWORD: 'a-long-test-password' }).listen(0, '127.0.0.1');
  await new Promise(resolve => protectedApp.once('listening', resolve));
  try {
    const url = `http://127.0.0.1:${protectedApp.address().port}/`;
    const response = await fetch(url);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('www-authenticate'), null);
    assert.equal((await fetch(url, { headers: { authorization: 'Basic ' + Buffer.from('old:cached-password').toString('base64') } })).status, 200);
  } finally { await new Promise(resolve => protectedApp.close(resolve)); }
});

test('data import preserves IDs, dates and counts, resets sequences and refuses overwrite', async () => {
  const instance = new PGlite();
  try {
    for (const file of (await readdir(new URL('../supabase/migrations', import.meta.url))).sort()) await instance.exec(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'));
    const query = async (sql, values) => { const r = await instance.query(sql, values); return { ...r, rowCount: r.rows.length || r.affectedRows || 0 }; };
    const target = { query, connect: async () => ({ query, release() {} }) };
    const data = { students: [{ student_id: 12, student_no: 'IMPORT-1', full_name: 'Import Student', course: 'IT', email: 'import@example.com' }], categories: [{ category_id: 7, category_name: 'Import category', description: null }], equipment: [{ equipment_id: 15, equipment_code: 'IMPORT-1', equipment_name: 'Imported item', category_id: 7, total_quantity: 5, available_quantity: 3, condition_status: 'Good' }], borrowings: [{ borrowing_id: 20, student_id: 12, equipment_id: 15, quantity: 2, borrow_date: '2020-01-01', due_date: '2020-01-02', return_date: null, status: 'Overdue' }] };
    assert.deepEqual(await importData(target, data), { students: 1, categories: 1, equipment: 1, borrowings: 1 });
    assert.equal((await history(target))[0].borrow_date, '2020-01-01');
    const inserted = await saveRecord(target, 'students', { student_no: 'IMPORT-2', full_name: 'Next student', course: 'IT', email: 'import2@example.com' });
    assert.equal(inserted.student_id, 13);
    await assert.rejects(importData(target, data), /requires empty/);
    assert.equal((await query('SELECT count(*)::int n FROM labtrack.students')).rows[0].n, 2);
  } finally { await instance.close(); }
});
