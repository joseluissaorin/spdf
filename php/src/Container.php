<?php

declare(strict_types=1);

namespace Spdf;

/**
 * Safe opening of a SPDF container (contract §1).
 *
 * - gzip-wrapped files (legacy 4.x) are inflated to a temporary file, with a size limit;
 * - WAL-mode files are copied and switched to rollback journal, so that a read-only
 *   connection never needs to create `-wal`/`-shm` files;
 * - the connection is read-only, `query_only`, `trusted_schema=OFF`, never loads
 *   extensions, and rejects triggers or views other than the three legacy FTS triggers;
 * - blobs larger than the configured limit are refused.
 */
final class Container
{
    public const APPLICATION_ID = 1397769286;
    public const USER_VERSION = 500;
    public const LEGACY_TRIGGERS = ['fragmentos_ai', 'fragmentos_ad', 'fragmentos_au'];
    private const SQLITE_MAGIC = "SQLite format 3\0";

    public ?\PDO $pdo;
    /** '5.0', '4.1', '4.0'… */
    public string $version = '';
    public bool $legacy = false;
    public bool $gzipped = false;
    public int $applicationId = 0;
    public int $userVersion = 0;
    /** @var list<string> table names in sqlite_master */
    public array $tables = [];
    /** @var list<array{type:string,name:string}> triggers and views found */
    public array $forbidden = [];
    private ?string $tempPath = null;

    private function __construct()
    {
        $this->pdo = null;
    }

    /**
     * Opens a file. With `$strict` (the default), a container that breaks the safety
     * rules throws; the validator opens with `$strict = false` and reports instead.
     */
    public static function open(string $path, ?Options $options = null, bool $strict = true): self
    {
        $options ??= new Options();
        $c = new self();
        try {
            $c->openFile($path, $options, $strict);
        } catch (\Throwable $e) {
            $c->close();
            throw $e;
        }
        return $c;
    }

    private function openFile(string $path, Options $options, bool $strict): void
    {
        if (!is_file($path) || !is_readable($path)) {
            throw new SpdfException('E001', "Cannot read file: {$path}");
        }
        $head = self::readHead($path, 100);
        $real = realpath($path) ?: $path;
        if (strlen($head) >= 2 && $head[0] === "\x1f" && $head[1] === "\x8b") {
            $this->gzipped = true;
            $real = $this->inflate($real, $options);
            $head = self::readHead($real, 100);
        }
        if (strlen($head) < 100 || !str_starts_with($head, self::SQLITE_MAGIC)) {
            throw new SpdfException('E001', 'Not a SQLite database (nor gzip-wrapped SQLite).');
        }
        // WAL mode (header bytes 18 and 19 = 2): work on a copy in rollback mode.
        if (ord($head[18]) === 2 || ord($head[19]) === 2) {
            if ($this->tempPath === null) {
                $tmp = $this->newTemp($options);
                if (!copy($real, $tmp)) {
                    throw new SpdfException('E001', 'Cannot copy WAL-mode database to a temporary file.');
                }
                $real = $tmp;
            }
            $fh = fopen($real, 'r+b');
            fseek($fh, 18);
            fwrite($fh, "\x01\x01");
            fclose($fh);
        }

        try {
            $this->pdo = new \PDO('sqlite:' . $real, null, null, [
                \PDO::ATTR_ERRMODE => \PDO::ERRMODE_EXCEPTION,
                \PDO::ATTR_DEFAULT_FETCH_MODE => \PDO::FETCH_ASSOC,
                \PDO::ATTR_STRINGIFY_FETCHES => false,
                self::sqliteConst('ATTR_OPEN_FLAGS') => self::sqliteConst('OPEN_READONLY'),
            ]);
            $this->pdo->exec('PRAGMA query_only = 1');
            $this->pdo->exec('PRAGMA trusted_schema = OFF');
            $this->pdo->exec('PRAGMA cell_size_check = ON');
            $this->pdo->exec('PRAGMA mmap_size = 0');
            $master = $this->pdo->query('SELECT type, name FROM sqlite_master')->fetchAll();
        } catch (\PDOException $e) {
            throw new SpdfException('E001', 'SQLite cannot read this file: ' . $e->getMessage(), $e);
        }

        $this->applicationId = (int) $this->pdo->query('PRAGMA application_id')->fetchColumn();
        $this->userVersion = (int) $this->pdo->query('PRAGMA user_version')->fetchColumn();
        foreach ($master as $row) {
            if ($row['type'] === 'table') {
                $this->tables[] = $row['name'];
            }
        }
        $this->detectVersion();

        foreach ($master as $row) {
            if ($row['type'] === 'trigger' || $row['type'] === 'view') {
                $tolerated = $this->legacy && $row['type'] === 'trigger'
                    && in_array($row['name'], self::LEGACY_TRIGGERS, true);
                if (!$tolerated) {
                    $this->forbidden[] = ['type' => $row['type'], 'name' => $row['name']];
                }
            }
        }
        if ($strict && $this->forbidden !== []) {
            $f = $this->forbidden[0];
            throw new SpdfException('E020', "The file contains a {$f['type']} ({$f['name']}); refusing to open it.");
        }
        if ($strict) {
            $this->checkBlobSizes($options);
        }
    }

    private function detectVersion(): void
    {
        $has = fn (string $t): bool => in_array($t, $this->tables, true);
        if ($has('spdf_meta') && $this->applicationId === self::APPLICATION_ID && $this->userVersion === self::USER_VERSION) {
            $v = $this->pdo->query("SELECT value FROM spdf_meta WHERE key = 'spdf_version'")->fetchColumn();
            $this->version = is_string($v) && $v !== '' ? $v : '5.0';
            return;
        }
        if ($has('spdf') && $has('documentos')) {
            $this->legacy = true;
            $v = null;
            try {
                $v = $this->pdo->query("SELECT valor FROM spdf WHERE clave = 'spdf_version'")->fetchColumn();
            } catch (\PDOException) {
                $v = null;
            }
            if (!is_string($v) || $v === '') {
                $v = match ($this->userVersion) {
                    400 => '4.0',
                    410 => '4.1',
                    default => '4.1',
                };
            }
            if (!str_starts_with($v, '4')) {
                throw new SpdfException('E002', "Unknown legacy SPDF version: {$v}");
            }
            $this->version = $v;
            return;
        }
        throw new SpdfException('E002', sprintf(
            'Not a SPDF file (application_id %d, user_version %d).',
            $this->applicationId,
            $this->userVersion,
        ));
    }

    private function checkBlobSizes(Options $options): void
    {
        $checks = $this->legacy
            ? ['blobs' => 'datos', 'vectores' => 'valores']
            : ['blobs' => 'data', 'vectors' => 'data'];
        foreach ($checks as $table => $column) {
            if (!in_array($table, $this->tables, true)) {
                continue;
            }
            $max = (int) $this->pdo->query("SELECT coalesce(max(length({$column})), 0) FROM {$table}")->fetchColumn();
            if ($max > $options->maxBlobBytes) {
                throw new SpdfException('E001', "A blob in {$table} is {$max} bytes, above the limit of {$options->maxBlobBytes}.");
            }
        }
    }

    /** PDO SQLite constant, without the deprecation of PHP 8.5 (Pdo\\Sqlite since 8.4). */
    public static function sqliteConst(string $name): int
    {
        if (class_exists('Pdo\\Sqlite') && defined('Pdo\\Sqlite::' . $name)) {
            return constant('Pdo\\Sqlite::' . $name);
        }
        return constant('PDO::SQLITE_' . $name);
    }

    public function hasTable(string $name): bool
    {
        return in_array($name, $this->tables, true);
    }

    /** Column names of a table (empty if the table does not exist). */
    public function columns(string $table): array
    {
        if (!$this->hasTable($table)) {
            return [];
        }
        $rows = $this->pdo->query('PRAGMA table_info(' . self::quoteIdent($table) . ')')->fetchAll();
        return array_map(fn ($r) => $r['name'], $rows);
    }

    public static function quoteIdent(string $name): string
    {
        return '"' . str_replace('"', '""', $name) . '"';
    }

    public function close(): void
    {
        $this->pdo = null;
        if ($this->tempPath !== null) {
            @unlink($this->tempPath);
            $this->tempPath = null;
        }
    }

    public function __destruct()
    {
        $this->close();
    }

    private static function readHead(string $path, int $n): string
    {
        $fh = @fopen($path, 'rb');
        if ($fh === false) {
            throw new SpdfException('E001', "Cannot read file: {$path}");
        }
        $s = fread($fh, $n);
        fclose($fh);
        return $s === false ? '' : $s;
    }

    private function newTemp(Options $options): string
    {
        $dir = $options->tempDir ?? sys_get_temp_dir();
        $tmp = tempnam($dir, 'spdf');
        if ($tmp === false) {
            throw new SpdfException('E001', 'Cannot create a temporary file.');
        }
        $this->tempPath = $tmp;
        return $tmp;
    }

    private function inflate(string $path, Options $options): string
    {
        $tmp = $this->newTemp($options);
        $in = gzopen($path, 'rb');
        $out = fopen($tmp, 'wb');
        if ($in === false || $out === false) {
            throw new SpdfException('E001', 'Cannot inflate gzip-wrapped file.');
        }
        $total = 0;
        try {
            while (!gzeof($in)) {
                $chunk = gzread($in, 1 << 20);
                if ($chunk === false) {
                    throw new SpdfException('E001', 'Corrupt gzip stream.');
                }
                $total += strlen($chunk);
                if ($total > $options->maxInflatedBytes) {
                    throw new SpdfException('E001', "Inflated size exceeds the limit of {$options->maxInflatedBytes} bytes.");
                }
                fwrite($out, $chunk);
                if ($chunk === '') {
                    break;
                }
            }
        } finally {
            gzclose($in);
            fclose($out);
        }
        return $tmp;
    }
}
