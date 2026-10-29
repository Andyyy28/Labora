import { readFile, readdir } from 'node:fs/promises';
import { database, transaction } from '../src/db.js';
const db = database();
try {
  const files = (await readdir(new URL('../supabase/migrations/', import.meta.url))).filter(name => name.endsWith('.sql')).sort();
  await transaction(db, async client => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('labtrack-migrations'))");
    await client.query('CREATE SCHEMA IF NOT EXISTS labtrack');
    await client.query('CREATE TABLE IF NOT EXISTS labtrack.schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    await client.query('ALTER TABLE labtrack.schema_migrations ENABLE ROW LEVEL SECURITY');
    await client.query('REVOKE ALL ON labtrack.schema_migrations FROM PUBLIC');
    await client.query('REVOKE ALL ON SCHEMA labtrack FROM PUBLIC');
    for (const name of files) {
      if ((await client.query('SELECT name FROM labtrack.schema_migrations WHERE name=$1', [name])).rowCount) continue;
      await client.query(await readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8'));
      await client.query('INSERT INTO labtrack.schema_migrations(name) VALUES ($1)', [name]);
      console.log(`Applied ${name}`);
    }
  });
} finally { await db.end(); }
