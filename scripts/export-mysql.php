<?php
// CLI only: retain the original database and export current records without changes.
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);
$source = new mysqli(getenv('LAB_DB_HOST') ?: '127.0.0.1', getenv('LAB_DB_USER') ?: 'root', getenv('LAB_DB_PASSWORD') ?: '', getenv('LAB_DB_NAME') ?: 'lab_inventory_db', (int)(getenv('LAB_DB_PORT') ?: 3307));
$source->set_charset('utf8mb4');
$data = [];
foreach (['students', 'categories', 'equipment', 'borrowings'] as $table) {
    $data[$table] = $source->query('SELECT * FROM '.$table)->fetch_all(MYSQLI_ASSOC);
}
$directory = __DIR__.'/../migration-data';
if (!is_dir($directory)) mkdir($directory, 0700, true);
file_put_contents($directory.'/.htaccess', "Require all denied\n");
file_put_contents($directory.'/mysql-export.json', json_encode($data, JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR));
echo "Export saved to ignored migration-data/mysql-export.json\n";
foreach ($data as $table=>$records) echo $table.': '.count($records)." records\n";
