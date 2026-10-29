import pg from 'pg';
import { readFileSync } from 'node:fs';

let pool;
export function database() {
  if (!process.env.DATABASE_URL) throw new Error('Configure DATABASE_URL with your Supabase PostgreSQL connection string.');
  if (!pool) {
    const uri = new URL(process.env.DATABASE_URL);
    let ssl;
    if (uri.hostname.endsWith('.supabase.co') || uri.hostname.endsWith('.pooler.supabase.com')) {
      // pg connection-string SSL parameters replace the explicit ssl object.
      // Configure Supabase's private CA and hostname verification together here.
      for (const key of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'ssl', 'uselibpqcompat']) uri.searchParams.delete(key);
      ssl = { ca: readFileSync(new URL('../certs/supabase-ca.crt', import.meta.url), 'utf8'), rejectUnauthorized: true };
    }
    pool = new pg.Pool({ connectionString: uri.toString(), ...(ssl ? { ssl } : {}), max: 3, idleTimeoutMillis: 10000, connectionTimeoutMillis: 10000 });
    pool.on('error', error => console.error('Idle database connection failed:', error.code || error.name));
  }
  return pool;
}

export async function transaction(db, work) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL TIME ZONE 'Asia/Shanghai'");
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
