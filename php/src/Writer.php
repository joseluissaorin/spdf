<?php

declare(strict_types=1);

namespace Spdf;

/**
 * Builds a SPDF 5.0 file.
 *
 * ```php
 * $w = Spdf\Writer::create('out.spdf', generator: 'my-app/1.0');
 * $w->document(['id' => 'd1', 'kind' => 'pdf', 'metadata' => ['type' => 'book', 'title' => 'Lazarillo'], ...]);
 * $w->unit([...]); $w->fragment([...]);
 * $w->finish();
 * ```
 *
 * The file is written to a temporary path and moved into place by finish():
 * FTS index rebuilt, no triggers or views, VACUUM, journal mode DELETE.
 */
final class Writer
{
    public const SCHEMA = <<<'SQL'
CREATE TABLE spdf_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE documents (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, metadata TEXT NOT NULL, source_sha256 TEXT NOT NULL,
  source_ref TEXT, mime TEXT NOT NULL, bytes INTEGER NOT NULL, unit_count INTEGER NOT NULL,
  duration REAL, created TEXT NOT NULL, updated TEXT NOT NULL, title TEXT, authors TEXT,
  year INTEGER, language TEXT, rights TEXT
);
CREATE TABLE units (
  id TEXT PRIMARY KEY, document TEXT NOT NULL REFERENCES documents(id), ord INTEGER NOT NULL,
  anchor TEXT NOT NULL, text TEXT NOT NULL DEFAULT '', notes TEXT, header TEXT, footer TEXT,
  image TEXT, thumbnail TEXT, reader TEXT NOT NULL, confidence REAL NOT NULL DEFAULT 1,
  printed TEXT, t0 REAL, t1 REAL, words TEXT
);
CREATE INDEX units_doc ON units(document, ord);
CREATE INDEX units_printed ON units(document, printed);
CREATE TABLE sections (
  id TEXT PRIMARY KEY, document TEXT NOT NULL, parent TEXT, level INTEGER NOT NULL,
  title TEXT NOT NULL, unit_from TEXT NOT NULL, unit_to TEXT, summary TEXT
);
CREATE TABLE fragments (
  n INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, document TEXT NOT NULL, unit TEXT NOT NULL,
  ord INTEGER NOT NULL, text TEXT NOT NULL, context TEXT NOT NULL DEFAULT '', section TEXT,
  anchor TEXT NOT NULL, anchor_end TEXT, search_text TEXT
);
CREATE INDEX fragments_doc ON fragments(document, ord);
CREATE INDEX fragments_unit ON fragments(unit);
CREATE VIRTUAL TABLE fragments_fts USING fts5(
  text, context, section, search_text,
  content='fragments', content_rowid='n',
  tokenize='unicode61 remove_diacritics 2'
);
CREATE TABLE figures (
  id TEXT PRIMARY KEY, document TEXT NOT NULL, unit TEXT NOT NULL, image TEXT NOT NULL,
  caption TEXT, description TEXT, anchor TEXT NOT NULL
);
CREATE TABLE spaces (
  id TEXT PRIMARY KEY, provider TEXT NOT NULL, model TEXT NOT NULL, version TEXT,
  dims INTEGER NOT NULL, dtype TEXT NOT NULL DEFAULT 'f32', normalized INTEGER NOT NULL DEFAULT 1,
  truncated_from INTEGER, modalities TEXT NOT NULL, task_prefixes TEXT, created TEXT
);
CREATE TABLE vectors (
  target TEXT NOT NULL, id TEXT NOT NULL, space TEXT NOT NULL REFERENCES spaces(id),
  document TEXT NOT NULL, data BLOB NOT NULL, PRIMARY KEY (target, id, space)
);
CREATE TABLE blobs (key TEXT PRIMARY KEY, mime TEXT NOT NULL, sha256 TEXT NOT NULL, data BLOB NOT NULL);
CREATE TABLE provenance (
  document TEXT NOT NULL, stage TEXT NOT NULL, provider TEXT, model TEXT,
  detail TEXT, ms INTEGER, at TEXT NOT NULL
);
CREATE TABLE extensions (name TEXT PRIMARY KEY, version TEXT NOT NULL, required INTEGER NOT NULL DEFAULT 0);
SQL;

    public const TRIGRAM = "CREATE VIRTUAL TABLE fragments_fts_trigram USING fts5(text, content='fragments', content_rowid='n', tokenize='trigram')";

    private ?\PDO $pdo;
    private string $tmp;
    private ?string $documentId = null;
    /** @var array<string,array> space id => row */
    private array $spaces = [];
    private bool $trigram = false;
    private bool $finished = false;

    private function __construct(private readonly string $path, private readonly array $meta)
    {
        $dir = dirname($path);
        $this->tmp = $dir . DIRECTORY_SEPARATOR . '.' . basename($path) . '.' . bin2hex(random_bytes(4)) . '.tmp';
        $this->pdo = new \PDO('sqlite:' . $this->tmp, null, null, [
            \PDO::ATTR_ERRMODE => \PDO::ERRMODE_EXCEPTION,
            \PDO::ATTR_DEFAULT_FETCH_MODE => \PDO::FETCH_ASSOC,
        ]);
        $this->pdo->exec('PRAGMA page_size = 4096');
        $this->pdo->exec('PRAGMA journal_mode = DELETE');
        $this->pdo->exec('PRAGMA application_id = ' . Container::APPLICATION_ID);
        $this->pdo->exec('PRAGMA user_version = ' . Container::USER_VERSION);
        $this->pdo->exec('PRAGMA trusted_schema = OFF');
        $this->pdo->beginTransaction();
        foreach (array_filter(array_map('trim', explode(';', self::SCHEMA))) as $stmt) {
            $this->pdo->exec($stmt);
        }
    }

    /**
     * Starts a new file. `$meta` may add or override spdf_meta keys (license_note…);
     * spdf_version, created, generator and profile are filled in.
     */
    public static function create(string $path, string $generator = 'spdf-php/0.1.0', string $profile = 'core', array $meta = []): self
    {
        $meta = $meta + [
            'spdf_version' => '5.0',
            'profile' => $profile,
            'created' => gmdate('Y-m-d\TH:i:s\Z'),
            'generator' => $generator,
        ];
        return new self($path, $meta);
    }

    /** Also build the optional trigram index (CJK). */
    public function withTrigram(bool $on = true): self
    {
        $this->trigram = $on;
        return $this;
    }

    private static function json(mixed $v): ?string
    {
        if ($v === null) {
            return null;
        }
        if (is_string($v)) {
            return $v;
        }
        return Json::encode($v);
    }

    private function insert(string $table, array $row): void
    {
        $cols = array_keys($row);
        $sql = 'INSERT INTO ' . Container::quoteIdent($table) . ' (' . implode(', ', array_map([Container::class, 'quoteIdent'], $cols))
            . ') VALUES (' . implode(', ', array_fill(0, count($cols), '?')) . ')';
        $st = $this->pdo->prepare($sql);
        $i = 1;
        foreach ($row as $v) {
            $type = match (true) {
                $v === null => \PDO::PARAM_NULL,
                is_int($v) => \PDO::PARAM_INT,
                is_bool($v) => \PDO::PARAM_INT,
                default => \PDO::PARAM_STR,
            };
            if (is_float($v)) {
                $st->bindValue($i++, $v);
                continue;
            }
            if ($v instanceof Blob) {
                $st->bindValue($i++, $v->bytes, \PDO::PARAM_LOB);
                continue;
            }
            $st->bindValue($i++, is_bool($v) ? (int) $v : $v, $type);
        }
        $st->execute();
    }

    private static function pick(array $row, array $cols, array $json = [], array $defaults = []): array
    {
        $out = [];
        foreach ($cols as $c) {
            $v = array_key_exists($c, $row) ? $row[$c] : ($defaults[$c] ?? null);
            if (in_array($c, $json, true)) {
                $v = self::json($v);
            }
            $out[$c] = $v;
        }
        return $out;
    }

    /** The document row. `metadata` (CSL-JSON + spdf object) may be an array. */
    public function document(array $d): self
    {
        $this->documentId = (string) $d['id'];
        $m = is_array($d['metadata'] ?? null) ? $d['metadata'] : [];
        $defaults = [
            'created' => $this->meta['created'], 'updated' => $this->meta['created'],
            'title' => $m['title'] ?? null,
            'year' => $m['issued']['date-parts'][0][0] ?? null,
            'language' => $m['language'] ?? null,
            'authors' => isset($m['author']) && is_array($m['author'])
                ? (implode('; ', array_filter(array_map(fn ($p) => is_array($p) ? ($p['family'] ?? $p['literal'] ?? null) : null, $m['author']))) ?: null)
                : null,
        ];
        $this->insert('documents', self::pick($d, Document::COLUMNS['documents'], ['metadata', 'rights'], $defaults));
        return $this;
    }

    private function doc(array $row): string
    {
        return (string) ($row['document'] ?? $this->documentId ?? throw new SpdfException('E013', 'Call document() first.'));
    }

    public function unit(array $u): self
    {
        $u['document'] = $this->doc($u);
        if (isset($u['text'])) {
            $u['text'] = Text::nfc((string) $u['text']);
        }
        if (!array_key_exists('printed', $u) && is_array($u['anchor'] ?? null) && isset($u['anchor']['printed'])) {
            $u['printed'] = $u['anchor']['printed'];
        }
        $this->insert('units', self::pick($u, Document::COLUMNS['units'], ['anchor', 'notes', 'words'], ['text' => '', 'confidence' => 1.0]));
        return $this;
    }

    public function section(array $s): self
    {
        $s['document'] = $this->doc($s);
        $this->insert('sections', self::pick($s, Document::COLUMNS['sections']));
        return $this;
    }

    public function fragment(array $f): self
    {
        $f['document'] = $this->doc($f);
        foreach (['text', 'context', 'search_text'] as $k) {
            if (isset($f[$k]) && is_string($f[$k])) {
                $f[$k] = Text::nfc($f[$k]);
            }
        }
        $this->insert('fragments', self::pick($f, Document::COLUMNS['fragments'], ['section', 'anchor', 'anchor_end'], ['context' => '']));
        return $this;
    }

    public function figure(array $f): self
    {
        $f['document'] = $this->doc($f);
        $this->insert('figures', self::pick($f, Document::COLUMNS['figures'], ['anchor']));
        return $this;
    }

    public function space(array $s): self
    {
        $row = self::pick($s, Document::COLUMNS['spaces'], ['modalities', 'task_prefixes'], [
            'dtype' => 'f32', 'normalized' => 1, 'modalities' => ['text'],
        ]);
        $this->spaces[(string) $row['id']] = $row;
        $this->insert('spaces', $row);
        return $this;
    }

    /**
     * A vector: `$data` is a list of floats (encoded with the space dtype, i8 and
     * f16 quantized as the contract says) or the raw little-endian bytes as a Blob.
     */
    public function vector(string $target, string $id, string $space, array|Blob $data, ?string $document = null): self
    {
        $sp = $this->spaces[$space] ?? throw new SpdfException('E031', "Declare space {$space} before its vectors.");
        $bytes = $data instanceof Blob ? $data->bytes : Vectors::encode($data, (string) $sp['dtype']);
        if (strlen($bytes) !== (int) $sp['dims'] * Vectors::size((string) $sp['dtype'])) {
            throw new SpdfException('E030', "Vector {$target}/{$id} has the wrong length for space {$space}.");
        }
        $this->insert('vectors', [
            'target' => $target, 'id' => $id, 'space' => $space,
            'document' => $document ?? $this->documentId ?? '', 'data' => new Blob($bytes),
        ]);
        return $this;
    }

    public function blob(string $key, string $mime, string $data): self
    {
        $this->insert('blobs', ['key' => $key, 'mime' => $mime, 'sha256' => hash('sha256', $data), 'data' => new Blob($data)]);
        return $this;
    }

    public function provenance(array $p): self
    {
        $p['document'] = $this->doc($p);
        $this->insert('provenance', self::pick($p, Document::COLUMNS['provenance'], ['detail']));
        return $this;
    }

    public function extension(string $name, string $version, bool $required = false): self
    {
        $this->insert('extensions', ['name' => $name, 'version' => $version, 'required' => $required ? 1 : 0]);
        return $this;
    }

    /**
     * Finalizes: spdf_meta, FTS rebuild, optional content hash, VACUUM, atomic rename.
     * Returns the path written.
     */
    public function finish(bool $contentHash = false): string
    {
        if ($this->finished) {
            return $this->path;
        }
        $meta = $this->meta;
        if ($this->documentId !== null && !isset($meta['document_id'])) {
            $meta['document_id'] = $this->documentId;
        }
        foreach ($meta as $k => $v) {
            $this->insert('spdf_meta', ['key' => (string) $k, 'value' => (string) $v]);
        }
        $this->pdo->exec("INSERT INTO fragments_fts(fragments_fts) VALUES('rebuild')");
        if ($this->trigram) {
            $this->pdo->exec(self::TRIGRAM);
            $this->pdo->exec("INSERT INTO fragments_fts_trigram(fragments_fts_trigram) VALUES('rebuild')");
        }
        $this->pdo->commit();
        if ($contentHash) {
            $this->pdo = null;
            $doc = Document::open($this->tmp);
            $hash = $doc->contentSha256();
            $doc->close();
            $this->pdo = new \PDO('sqlite:' . $this->tmp, null, null, [\PDO::ATTR_ERRMODE => \PDO::ERRMODE_EXCEPTION]);
            $st = $this->pdo->prepare("INSERT INTO spdf_meta(key, value) VALUES ('content_sha256', ?)");
            $st->execute([$hash]);
        }
        $this->pdo->exec('VACUUM');
        $this->pdo = null;
        if (!rename($this->tmp, $this->path)) {
            throw new SpdfException('E001', "Cannot move the new file into {$this->path}.");
        }
        $this->finished = true;
        return $this->path;
    }

    /** Discards an unfinished file. */
    public function abort(): void
    {
        if ($this->finished) {
            return;
        }
        if ($this->pdo !== null && $this->pdo->inTransaction()) {
            $this->pdo->rollBack();
        }
        $this->pdo = null;
        @unlink($this->tmp);
        $this->finished = true;
    }

    public function __destruct()
    {
        if (!$this->finished) {
            $this->abort();
        }
    }
}
