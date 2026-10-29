import { transaction } from '../src/db.js';
import { modules } from '../src/domain.js';

export async function importData(db, data) {
  return transaction(db, async client => {
    await client.query('LOCK TABLE labtrack.students,labtrack.categories,labtrack.equipment,labtrack.borrowings IN ACCESS EXCLUSIVE MODE');
    for (const table of ['students', 'categories', 'equipment', 'borrowings']) {
      if ((await client.query(`SELECT 1 FROM labtrack.${table} LIMIT 1`)).rowCount) throw new Error('Import requires empty LabTrack tables; no existing data was changed.');
    }
    const counts = {};
    for (const table of ['students', 'categories', 'equipment', 'borrowings']) {
      if (!Array.isArray(data[table])) throw new Error(`Missing ${table} array in export.`);
      const pk = table === 'borrowings' ? 'borrowing_id' : modules[table].pk;
      const keys = table === 'borrowings' ? ['borrowing_id', 'student_id', 'equipment_id', 'quantity', 'borrow_date', 'due_date', 'return_date', 'status'] : [pk, ...Object.keys(modules[table].fields)];
      for (const row of data[table]) await client.query(`INSERT INTO labtrack.${table} (${keys.join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')})`, keys.map(key => row[key] ?? null));
      await client.query(`SELECT setval(pg_get_serial_sequence('labtrack.${table}', '${pk}'), COALESCE(max(${pk}),1), count(*)>0) FROM labtrack.${table}`);
      counts[table] = data[table].length;
    }
    const inconsistent = await client.query('SELECT e.equipment_id FROM labtrack.equipment e LEFT JOIN labtrack.borrowings b ON b.equipment_id=e.equipment_id AND b.return_date IS NULL GROUP BY e.equipment_id HAVING e.available_quantity + COALESCE(sum(b.quantity),0) > e.total_quantity');
    if (inconsistent.rowCount) throw new Error('Source inventory is inconsistent with active loans. Import rolled back.');
    return counts;
  });
}
