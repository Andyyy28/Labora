# Supabase and Vercel setup

The application now runs on Node.js 22, Express, and PostgreSQL. The PHP/MySQL files remain as the original local version. Vercel runs `src/app.js`; it does not run PHP. The new Supabase project Labora (hddxljyqyfisjceioyhk) contains the migrated schema and current records.

## 1. Create the Supabase project

Create a new project in your Supabase dashboard. Keep its database password private. For Vercel, use **Connect → Transaction pooler** and copy the PostgreSQL URI (port 6543). The current .env uses the confirmed transaction pooler aws-0-eu-west-1.pooler.supabase.com on port 6543. Direct endpoints can require IPv6. URL-encode special characters in the password and append `?sslmode=verify-full` for certificate-verified TLS. The pooler hostname must come from your project's Connect dialog.

The ignored `.env` has been created with your project URI and generated app secrets. The saved database password is URL-encoded. When replacing it, URL-encode reserved characters. For another installation, copy `.env.example` to `.env` and fill in:

```dotenv
DATABASE_URL=postgresql://postgres.PROJECT_REF:ENCODED_PASSWORD@POOLER_HOST:6543/postgres?sslmode=verify-full
SESSION_SECRET=YOUR_RANDOM_SECRET_AT_LEAST_32_CHARACTERS
```

Generate separate random values locally with:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Never commit `.env`, the database password, or the MySQL export. Do not put these values in browser code. This implementation connects to Supabase PostgreSQL from the server; a Supabase publishable key or service-role API key is not needed. Use the database owner connection for the initial setup and this server-only workspace. Its privileges bypass RLS, so keep the URI private.

## 2. Apply the schema and transfer the current records

```powershell
npm ci
npm run db:migrate
```

The migration creates an isolated `labtrack` schema, foreign keys, constraints, indexes, and RLS. Keep this schema out of the Supabase Data API exposed schemas. No anonymous or authenticated API policies are granted because all queries run on the server.

On the original migration machine, the current MySQL export has been saved locally in ignored `migration-data/mysql-export.json`. If MySQL records change before cutover, pause writes in the PHP application and refresh it:

```powershell
$env:LAB_DB_PASSWORD = "YOUR_LOCAL_MYSQL_PASSWORD"
D:\XAMPP\php\php.exe scripts/export-mysql.php
```

The initial import is already complete in Labora. For a different empty target, import it:

```powershell
npm run db:import
```

Import requires empty LabTrack tables and uses one transaction. It preserves IDs, relationships, dates, statuses and stock, validates stock against outstanding loans, and resets identity sequences. It refuses to overwrite existing records. It never deletes or modifies the original MySQL database. Migration and import are separate from application startup and deployment.

Do not resume writes to the old PHP database after cutover: changes there do not synchronize to Supabase. Retain the original database as a backup.

## 3. Verify and run

```powershell
npm test
npm run dev
```

Open `http://localhost:3000`. Pages and inventory forms are public and do not require a password. Production requires a `SESSION_SECRET` of at least 32 characters for CSRF tokens.

An optional disposable preview can run before Supabase is configured:

```powershell
node scripts/preview.js
```

It loads the ignored export into in-memory PostgreSQL, listens at `http://localhost:3000`, and discards changes on shutdown. It does not connect to Supabase. Do not run it and `npm run dev` on port 3000 simultaneously.

## 4. GitHub and Vercel

The source repository is https://github.com/Andyyy28/Labora. This folder has its own Git repository; the unrelated ancestor repository is not used.

Push only reviewed source. `.gitignore` excludes credentials, node_modules, the current data export and old submission archives. The original PHP files, SQL dumps, screenshots and local exports are excluded from Git.

Import the repository into Vercel and select the Express framework if detection asks. Use Node.js 22 and the default project root. Express is exported from the documented `src/app.js` entry point and assets live in `public/assets`. No compilation/build command is required. Configure these server environment variables for the deployment environments you use:

- `DATABASE_URL`
- `SESSION_SECRET`

For an isolated preview environment, use a separate database so preview changes cannot alter production inventory. Deploy only after migrating and importing the target database. Check counts against the source export, and verify a borrow/return transaction. Application secrets are configured separately on Vercel and must never be committed.

## Verified locally

`npm test` passes 10 test groups against embedded PostgreSQL (PGlite), covering schema security, borrowing/returns, validation, linked-record protection, rollback after a forced second-write failure, status/date/search filters, CRUD, HTML escaping, HTTP form flow, CSRF, password-free production access, and transactional import/sequence reset/overwrite refusal.

The actual MySQL export also imports into the disposable PostgreSQL preview: **9 students, 4 categories, 10 equipment records, 10 borrowings**. The initial preview shows **86 total units, 78 available units and 5 active loans**. These are the current database values, rather than the older sample dataset.

The hosted schema and imported records were verified through the Supabase connector. The Node.js connection and authenticated application pages have also been verified against the live Supabase database through its transaction pooler. Multi-connection contention and Vercel deployment remain unverified.

## References

- [Supabase database connections](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Express on Vercel](https://vercel.com/docs/frameworks/backend/express)

Hosted advisor checks completed: no warning or error findings. Informational notices are expected for the private schema: [RLS enabled without public policies](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), and [indexes not yet used](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index) on a new small database.

## Verified TLS configuration

`src/db.js` loads the bundled public Supabase Root 2021 CA from `certs/supabase-ca.crt` for Supabase endpoints. Certificate and hostname verification remain enabled. Keep this certificate file with the server source when deploying; it is a public trust certificate, not a secret. The certificate was obtained from https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt and expires April 26, 2031. See [Supabase SSL documentation](https://supabase.com/docs/guides/platform/ssl-enforcement).
