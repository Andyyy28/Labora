// Optional local preview backed by a disposable PostgreSQL instance.
// Imports the ignored MySQL export, never connects to or changes a hosted project.
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { createApp } from '../src/app.js';
import { importData } from './import-data.js';
const instance = new PGlite();
for (const file of (await readdir(new URL('../supabase/migrations', import.meta.url))).sort()) await instance.exec(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'));
// Serialize complete requests so transactions cannot interleave on PGlite's one connection.
let queue = Promise.resolve();
const query = async (sql, values) => { const r = await instance.query(sql, values); return { ...r, rowCount: r.rows.length || r.affectedRows || 0 }; };
const db = { query, connect: async () => ({ query, release() {} }) };
const counts = await importData(db, JSON.parse(await readFile('migration-data/mysql-export.json', 'utf8')));
console.log('Disposable PostgreSQL preview imported:', counts);
const app = createApp(() => db, { SESSION_SECRET: 'local-preview-only-secret-'.repeat(3) });
const { default: express } = await import('express');
const gate = express();
gate.use((req, res) => {
  queue = queue.then(() => new Promise(resolve => { res.once('finish', resolve); res.once('close', resolve); app(req, res); }));
});
const server = gate.listen(3000, '127.0.0.1', () => console.log('Disposable preview: http://localhost:3000'));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(async () => { await instance.close(); process.exit(); }));
