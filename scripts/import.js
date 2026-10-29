import { readFile } from 'node:fs/promises';
import { database } from '../src/db.js';
import { importData } from './import-data.js';
const db = database();
try {
  const data = JSON.parse(await readFile(process.argv[2] || 'migration-data/mysql-export.json', 'utf8'));
  const counts = await importData(db, data);
  for (const [table, count] of Object.entries(counts)) console.log(`${table}: ${count} records imported`);
  console.log('Import committed. Original MySQL database unchanged.');
} finally { await db.end(); }
