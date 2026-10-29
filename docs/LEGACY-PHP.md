# LabTrack — Laboratory Equipment & Borrowing

PHP/MySQL CRUD Laboratory · **Exercise 2 / Hard Level only**.

## Open the application

Start Apache and MySQL in XAMPP, then open **http://localhost/Hard_Level/**.
The application is already installed in `D:\XAMPP\htdocs\Hard_Level` and its sample database has been created.

- Database: `lab_inventory_db`
- MySQL host: `127.0.0.1`, port: `3307`
- Local XAMPP account: `root`; the provided password is configured in `db.php`.
- Optional environment overrides: `LAB_DB_USER` and `LAB_DB_PASSWORD`.
- Application and SQL session timezone: UTC+08:00.

On another installation, import **either** `database.sql` (fresh sample dates relative to import day) **or** `database-export.sql` (the actual database export with fixed dates), not both. Use an empty laboratory database. Existing tables are not dropped. Back up any existing database before replacing or changing it. The CLI-only `php tests/setup.php` can initialize a fresh installation and skips an existing database.

If the folder is renamed, update `BASE` in `includes/bootstrap.php`.

## Modules

- **Overview:** registered students, equipment types, available units, active borrowing transactions, overdue transactions, stock chart, and recent activity.
- **Students:** create, read, edit, delete, search; unique student number and email; email and required-field validation.
- **Categories:** complete CRUD and search; assigned categories cannot be deleted.
- **Equipment:** complete CRUD and combined search/category/condition filters; unique code, positive total quantity, nonnegative available quantity, and loan-aware stock validation.
- **Borrowing:** named student/equipment selectors, quantity, borrow date, and due date. Rejects unavailable stock, equipment under repair, invalid quantities, future borrow dates, and reversed dates.
- **Returns:** date validation, confirmation, stock restoration, and protection against repeated returns.
- **History:** joined student/equipment/category names, all required dates and quantities, computed status, combined search/status/borrow-date-range filters.

The initial dataset contains **8 fictional students, 4 categories, 10 equipment types, and 8 borrowing records**. There are 86 total units, 77 available units, and 9 units on loan across 5 active transactions. Two are overdue on the seed date. Equipment under repair remains part of physical inventory but cannot be lent.

## Data integrity and implementation

`db.php` shares a MySQLi connection and prepared-query helpers. Every query containing submitted data uses prepared statements. Table and column names used by shared CRUD code come exclusively from a fixed internal configuration.

`includes/manage.php` implements the three CRUD modules through the separate `index.php`, `add.php`, `edit.php`, and `delete.php` route files in each module directory. All writes require POST and a session CSRF token; deletion requires a dedicated confirmation page. Output is HTML-escaped. SQL errors are logged server-side and replaced with friendly feedback.

`includes/operations.php` performs borrowing and returns in InnoDB transactions. Borrowing locks the equipment row, validates its current stock, inserts the loan, updates stock, and commits. Returns lock the borrowing and equipment rows, reject completed returns, update both records, and commit. Any failure rolls back both writes.

Foreign keys use `ON DELETE RESTRICT`; history is never cascade-deleted. Students with any borrowing record, assigned categories, and equipment with any borrowing record cannot be deleted. Equipment protection includes returned history to preserve the required JOIN-based audit trail.

Available quantity cannot exceed total minus units currently on loan. A lower value may represent reserved or otherwise unavailable units. Total quantity cannot be reduced below units on loan. Status is computed on reads from return date and today's date, so overdue display stays current without a scheduled job and returned records never become overdue.

## Verification and submission

See `TEST_RESULTS.md`. Required screenshots are in `screenshots/`. `database-export.sql` is an actual SQL export of the verified sample database. `submission/Hard_Level_Submission.zip` includes source, SQL files, documentation, tests, and screenshots.

Run the database tests with:

```powershell
D:\XAMPP\php\php.exe tests/verify.php
```

The tests create temporary QA records, test real writes and a temporary failure trigger, and clean up their own records. Use only this laboratory database; the test account needs trigger permission. Browser checks use Playwright and installed Microsoft Edge. Set `PLAYWRIGHT_MODULE` to your Playwright module location if different from the bundled location in `tests/browser.cjs`, then run the file with Node.js. XAMPP must be running. Browser tests create and remove their own QA records and refresh screenshots.

The design uses the supplied `#ECF0F3` background, `#D1D9E6`/white soft shadows, raised and inset controls, and pastel lavender, blue, mint, yellow, and pink. Google Fonts enhances typography when internet is available; local sans-serif fallbacks keep the application functional offline.

This is a local laboratory assignment. It does not implement authentication; do not expose the XAMPP project publicly with its local development configuration.
