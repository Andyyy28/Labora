import express from 'express';
import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { database } from './db.js';
import { modules, positive, saveRecord, deleteRecord, borrowEquipment, returnEquipment, history, friendly } from './domain.js';
import * as views from './views.js';

const equal = (a, b) => { const aa = Buffer.from(String(a)), bb = Buffer.from(String(b)); return aa.length === bb.length && timingSafeEqual(aa, bb); };
export function createApp(dbProvider = database, settings = process.env) {
  const app = express();
  app.disable('x-powered-by');
  const production = settings.NODE_ENV === 'production' || Boolean(settings.VERCEL);
  const secret = settings.SESSION_SECRET || (production ? '' : randomBytes(32).toString('hex'));
  app.use((req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin' });
    if (production && (!secret || secret.length < 32 || !settings.LAB_APP_PASSWORD || settings.LAB_APP_PASSWORD.length < 16)) return res.status(503).send('Set SESSION_SECRET (32+ characters) and LAB_APP_PASSWORD (16+ characters) before deploying.');
    if (settings.LAB_APP_PASSWORD) {
      const auth = req.headers.authorization || '';
      const decoded = auth.startsWith('Basic ') ? Buffer.from(auth.slice(6), 'base64').toString() : '';
      if (!equal(decoded, `labtrack:${settings.LAB_APP_PASSWORD}`)) return res.set('WWW-Authenticate', 'Basic realm="LabTrack", charset="UTF-8"').status(401).send('Sign in to your laboratory workspace.');
    }
    next();
  });
  app.use('/assets', express.static(fileURLToPath(new URL('../public/assets', import.meta.url))));
  app.use(express.urlencoded({ extended: false, limit: '20kb' }));
  app.use((req, res, next) => {
    const sign = value => createHmac('sha256', secret).update(value).digest('hex');
    const cookieName = production ? '__Host-labtrack_csrf' : 'labtrack_csrf';
    const cookies = Object.fromEntries((req.headers.cookie || '').split(';').map(s => s.trim().split(/=(.*)/s).slice(0, 2)));
    let token = cookies[cookieName] || '';
    const [nonce, signature] = token.split('.');
    if (!nonce || !signature || !equal(signature, sign(nonce))) {
      const value = randomBytes(32).toString('hex'); token = `${value}.${sign(value)}`;
      res.cookie(cookieName, token, { httpOnly: true, secure: production, sameSite: 'strict', path: '/' });
    }
    res.locals.csrf = token;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && (!req.body || typeof req.body.csrf !== 'string' || !equal(req.body.csrf, token))) return res.status(403).send(views.layout('Session expired', '', views.notice('Reload the page and try again.')));
    next();
  });
  const send = (res, title, section, body, message) => res.send(views.layout(title, section, body, message));
  const categories = async db => (await db.query('SELECT * FROM labtrack.categories ORDER BY category_name')).rows;
  app.get('/', async (req, res) => {
    const db = dbProvider();
    const stats = (await db.query(`SELECT (SELECT count(*) FROM labtrack.students)::int students, count(*)::int types, COALESCE(sum(total_quantity),0)::int total, COALESCE(sum(available_quantity),0)::int available, (SELECT count(*) FROM labtrack.borrowings WHERE return_date IS NULL)::int active, (SELECT count(*) FROM labtrack.borrowings WHERE return_date IS NULL AND due_date < (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date)::int overdue FROM labtrack.equipment`)).rows[0];
    send(res, 'A good day for discovery.', 'dashboard', views.dashboard(stats, await history(db, {}, 5)));
  });
  app.get('/borrowings', async (req, res) => {
    let records = [], error = '';
    try { records = await history(dbProvider(), req.query); } catch (ex) { if (ex.code) throw ex; error = friendly(ex); res.status(400); }
    const messages = { borrowed: 'Borrowing recorded. Available stock has been updated.', returned: 'Equipment returned. Available stock has been restored.' };
    send(res, 'Borrowing history', 'borrowings', views.historyPage(records, req.query, error), messages[req.query.done]);
  });
  app.all('/borrowings/borrow', async (req, res) => {
    if (!['GET', 'POST'].includes(req.method)) return res.sendStatus(405);
    const db = dbProvider(); let error = '';
    if (req.method === 'POST') {
      try { await borrowEquipment(db, req.body); return res.redirect(303, '/borrowings?done=borrowed'); }
      catch (ex) { error = friendly(ex); res.status(400); }
    }
    const students = (await db.query('SELECT * FROM labtrack.students ORDER BY full_name')).rows;
    const equipment = (await db.query('SELECT * FROM labtrack.equipment ORDER BY equipment_name')).rows;
    send(res, 'Borrow equipment', 'borrowings', views.borrowingForm(students, equipment, req.body || {}, res.locals.csrf, error));
  });
  app.all('/borrowings/return', async (req, res) => {
    if (!['GET', 'POST'].includes(req.method)) return res.sendStatus(405);
    const db = dbProvider(), id = positive(req.query.id, 'Borrowing ID'); let error = '';
    const record = (await db.query('SELECT b.*,b.borrow_date::text,b.due_date::text,b.return_date::text,s.full_name,e.equipment_name FROM labtrack.borrowings b JOIN labtrack.students s USING(student_id) JOIN labtrack.equipment e USING(equipment_id) WHERE borrowing_id=$1', [id])).rows[0];
    if (!record) return res.status(404).send(views.layout('Record not found', 'borrowings', views.notice('Borrowing record not found.')));
    if (req.method === 'POST') {
      try { await returnEquipment(db, id, req.body.return_date); return res.redirect(303, '/borrowings?status=Returned&done=returned'); }
      catch (ex) { error = friendly(ex); res.status(400); }
    }
    send(res, 'Return equipment', 'borrowings', views.returnForm(record, res.locals.csrf, req.body?.return_date, error));
  });
  for (const [module, config] of Object.entries(modules)) {
    app.get(`/${module}`, async (req, res) => {
      const db = dbProvider(), conditions = [], values = [];
      const add = (sql, value) => { values.push(value); conditions.push(sql.replace('?', `$${values.length}`)); };
      const keys = Object.keys(config.fields).filter(key => !['category_id', 'total_quantity', 'available_quantity'].includes(key));
      if (typeof req.query.q === 'string' && req.query.q.trim()) add(`concat_ws(' ',${keys.map(key => `t.${key}`).join(',')}) ILIKE ?`, `%${req.query.q.trim()}%`);
      if (module === 'equipment') {
        if (req.query.category_id) add('t.category_id = ?', positive(req.query.category_id, 'Category'));
        if (['Good', 'For Repair'].includes(req.query.condition_status)) add('t.condition_status = ?', req.query.condition_status);
      }
      const sql = `SELECT t.*${module === 'equipment' ? ',c.category_name' : ''} FROM labtrack.${module} t ${module === 'equipment' ? 'JOIN labtrack.categories c USING(category_id)' : ''} ${conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''} ORDER BY t.${config.pk} DESC`;
      const records = (await db.query(sql, values)).rows;
      const messages = { saved: `${config.singular} saved.`, deleted: `${config.singular} deleted.` };
      send(res, config.title, module, views.directory(module, records, req.query, module === 'equipment' ? await categories(db) : []), messages[req.query.done]);
    });
    for (const action of ['add', 'edit', 'delete']) app.all(`/${module}/${action}`, async (req, res) => {
      if (!['GET', 'POST'].includes(req.method)) return res.sendStatus(405);
      const db = dbProvider(), id = action === 'add' ? null : positive(req.query.id, 'Record ID');
      let record = {}, error = '';
      if (id) {
        record = (await db.query(`SELECT * FROM labtrack.${module} WHERE ${config.pk}=$1`, [id])).rows[0];
        if (!record) return res.status(404).send(views.layout('Record not found', module, views.notice('This record does not exist.')));
      }
      if (req.method === 'POST') {
        try {
          if (action === 'delete') await deleteRecord(db, module, id); else await saveRecord(db, module, req.body, id);
          return res.redirect(303, `/${module}?done=${action === 'delete' ? 'deleted' : 'saved'}`);
        } catch (ex) { error = friendly(ex); if (action !== 'delete') record = req.body; res.status(400); }
      }
      send(res, `${action[0].toUpperCase() + action.slice(1)} ${config.singular.toLowerCase()}`, module, views.recordForm(module, action, record, module === 'equipment' ? await categories(db) : [], res.locals.csrf, error));
    });
  }
  app.use((req, res) => res.status(404).send(views.layout('Page not found', '', '<section class="panel"><p>This page does not exist.</p><a class="button" href="/">Go to overview</a></section>')));
  app.use((error, req, res, next) => {
    console.error(error.code || error.message);
    const status = error.code || error.message?.includes('DATABASE_URL') ? 503 : 400;
    res.status(status).send(views.layout(status === 503 ? 'Connection unavailable' : 'Invalid request', '', views.notice(status === 503 ? 'We could not reach the laboratory database. Check your Supabase connection settings.' : friendly(error))));
  });
  return app;
}
export default createApp();
