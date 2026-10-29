# LabTrack — Laboratory Equipment & Borrowing

Vercel-compatible Node.js/Express application with Supabase PostgreSQL. Preserves the original laboratory dashboard, students/categories/equipment CRUD, borrowing, returns, stock rules, joined history and filters.

## Setup

See [Supabase and Vercel setup](docs/SUPABASE-VERCEL.md) for connection settings, importing existing records, and deployment.

```powershell
npm ci
# Copy .env.example to .env and fill in your Supabase URI and secrets.
npm run db:migrate
npm run db:import
npm run dev
```

Open http://localhost:3000. Workspace username: `labtrack`; password: `LAB_APP_PASSWORD` from your environment.

```powershell
npm test
```

Ten PostgreSQL/HTTP test groups cover inventory integrity, transactions and rollback, CRUD, filters, CSRF, access protection, and data import. Schema and current records have been migrated to the new Supabase project Labora (hddxljyqyfisjceioyhk). The ignored .env is configured, and live database connectivity has been verified.

## Source layout

- `src/app.js`: Express entry point for Vercel; protected routes and form handling.
- `src/domain.js`: prepared PostgreSQL queries, validation and atomic borrowing/return operations.
- `src/views.js`: HTML rendering using the original visual design.
- `src/db.js`: small serverless connection pool and transaction helper.
- `public/assets/`: original stylesheet, client script and logo.
- `supabase/migrations/`: PostgreSQL schema, constraints, indexes and RLS.
- `scripts/`: schema migration, MySQL export and transactional import tools.
- `tests/postgres.test.js`: current automated verification.

The existing PHP files, SQL dumps, original tests and screenshots remain as legacy references. Their original documentation is in [docs/LEGACY-PHP.md](docs/LEGACY-PHP.md). They are not the Vercel runtime. MySQL was exported read-only and remains unchanged. Real credentials and the current export are ignored by Git.

The protected server connects directly to PostgreSQL. The private `labtrack` schema is not exposed through the Supabase Data API; no browser database credentials are used. Production requires `DATABASE_URL`, `SESSION_SECRET` (32+ characters), and `LAB_APP_PASSWORD` (16+ characters).
