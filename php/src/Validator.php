<?php

declare(strict_types=1);

namespace Spdf;

/**
 * Validation (contract §12). Checks run in the order of the contract; a fatal error
 * (E001, E002) stops. `valid` means no errors; warnings do not count.
 */
final class Validator
{
    public const REQUIRED_TABLES = [
        'spdf_meta', 'documents', 'units', 'sections', 'fragments', 'fragments_fts', 'figures', 'spaces',
        'vectors', 'blobs', 'provenance', 'extensions',
    ];
    public const LEGACY_TABLES = [
        'spdf', 'documentos', 'unidades', 'secciones', 'fragmentos', 'fragmentos_fts', 'figuras', 'espacios',
        'vectores', 'blobs', 'procedencia',
    ];
    /** Legacy columns that 4.0 files may lack. */
    private const LEGACY_OPTIONAL = ['palabras', 'texto_busqueda'];
    public const REQUIRED_META = ['spdf_version', 'profile', 'created', 'generator', 'document_id'];
    public const ANCHOR_TYPES = ['page', 'time', 'section', 'slide', 'sheet', 'web', 'image', 'verse', 'canonical'];

    private array $errors = [];
    private array $warnings = [];

    /**
     * @return array{valid:bool, version:?string, profile:list<string>, errors:list<array>, warnings:list<array>}
     */
    public static function validate(string $path, ?Options $options = null): array
    {
        return (new self())->run($path, $options ?? new Options());
    }

    private function error(string $code, string $message, ?string $where = null): void
    {
        $this->errors[] = ['code' => $code, 'message' => $message, 'where' => $where];
    }

    private function warning(string $code, string $message, ?string $where = null): void
    {
        $this->warnings[] = ['code' => $code, 'message' => $message, 'where' => $where];
    }

    private function result(?string $version, array $profile): array
    {
        return [
            'valid' => $this->errors === [],
            'version' => $version,
            'profile' => $profile,
            'errors' => $this->errors,
            'warnings' => $this->warnings,
        ];
    }

    private function run(string $path, Options $options): array
    {
        try {
            $c = Container::open($path, $options, false);
        } catch (SpdfException $e) {
            $this->error($e->spdfCode, $e->getMessage());
            return $this->result(null, []);
        }
        try {
            return $this->checks($c, $path);
        } finally {
            $c->close();
        }
    }

    private function checks(Container $c, string $path): array
    {
        $pdo = $c->pdo;
        $legacy = $c->legacy;
        if ($c->gzipped && !$legacy) {
            $this->warning('E003', 'SPDF 5.0 file wrapped in gzip; distribute it uncompressed.');
        }
        if ($legacy) {
            $this->warning('W110', "Legacy SPDF {$c->version} file (read through the 5.0 view).");
        } elseif ($c->userVersion > Container::USER_VERSION) {
            $this->warning('W105', "Newer minor version (user_version {$c->userVersion}).");
        }
        foreach ($c->forbidden as $f) {
            $this->error('E020', "{$f['type']} present: {$f['name']}", $f['name']);
        }

        // Required tables and columns.
        $tables = $legacy ? self::LEGACY_TABLES : self::REQUIRED_TABLES;
        $missingTables = [];
        foreach ($tables as $t) {
            if (!$c->hasTable($t)) {
                $this->error('E010', "Missing required table {$t}.", $t);
                $missingTables[$t] = true;
            }
        }
        $missingColumns = [];
        foreach (Document::COLUMNS as $table => $cols) {
            $phys = $legacy ? (Legacy::TABLES[$table][0] ?? null) : $table;
            if ($phys === null || !$c->hasTable($phys)) {
                continue;
            }
            $have = $c->columns($phys);
            foreach ($cols as $col) {
                $name = $legacy ? Legacy::legacyColumn($table, $col) : $col;
                if ($name === null || ($legacy && in_array($name, self::LEGACY_OPTIONAL, true))) {
                    continue;
                }
                if (!in_array($name, $have, true)) {
                    $this->error('E011', "Missing required column {$phys}.{$name}.", "{$phys}.{$name}");
                    $missingColumns["{$table}.{$col}"] = true;
                }
            }
        }
        // Without the core tables nothing else can be read meaningfully.
        $core = $legacy ? ['spdf', 'documentos'] : ['spdf_meta', 'documents'];
        foreach ($core as $t) {
            if (isset($missingTables[$t])) {
                return $this->result($c->version, []);
            }
        }
        if ($missingColumns !== []) {
            return $this->result($c->version, []);
        }

        $doc = Document::fromContainer($c);
        $meta = $doc->meta();
        $profile = isset($meta['profile']) ? array_values(array_filter(explode(' ', (string) $meta['profile']))) : [];
        if (!$legacy) {
            foreach (self::REQUIRED_META as $k) {
                if (!array_key_exists($k, $meta)) {
                    $this->error('E012', "Missing spdf_meta key {$k}.", "spdf_meta.{$k}");
                }
            }
        }

        // Exactly one document.
        $docTable = $legacy ? 'documentos' : 'documents';
        $nDocs = (int) $pdo->query("SELECT count(*) FROM {$docTable}")->fetchColumn();
        if ($nDocs !== 1) {
            $this->error('E013', "documents holds {$nDocs} rows; exactly one is required.", 'documents');
        }

        // Metadata.
        if ($nDocs >= 1) {
            $metaCol = $legacy ? 'metadatos' : 'metadata';
            $raw = $pdo->query("SELECT {$metaCol} FROM {$docTable} LIMIT 1")->fetchColumn();
            try {
                $m = Json::decode((string) $raw);
                if ($legacy) {
                    $kind = $pdo->query("SELECT tipo FROM documentos LIMIT 1")->fetchColumn();
                    $m = Legacy::metadata($m, is_string($kind) ? $kind : null);
                }
                if (!is_array($m) || array_is_list($m) || !isset($m['type'], $m['title'])
                    || !is_string($m['type']) || !is_string($m['title'])) {
                    $this->error('E051', 'Metadata is not a CSL-JSON item (string type and title required).', 'documents.metadata');
                }
            } catch (\JsonException $e) {
                $this->error('E050', 'Metadata is not valid JSON: ' . $e->getMessage(), 'documents.metadata');
            }
            if (!$legacy) {
                $rights = $pdo->query('SELECT rights FROM documents LIMIT 1')->fetchColumn();
                if (is_string($rights)) {
                    try {
                        Json::decode($rights);
                    } catch (\JsonException $e) {
                        $this->error('E050', 'rights is not valid JSON.', 'documents.rights');
                    }
                }
            }
        }

        // Extensions.
        if (!$legacy && !isset($missingTables['extensions'])) {
            foreach ($pdo->query('SELECT name, required FROM extensions ORDER BY name') as $e) {
                if ((int) $e['required'] !== 0 && !in_array($e['name'], Document::KNOWN_EXTENSIONS, true)) {
                    $this->error('E060', "Unknown required extension {$e['name']}.", "extensions.{$e['name']}");
                }
            }
        }

        // units.ord contiguous from 1 (legacy units are renumbered by the view).
        if (!$legacy && !isset($missingTables['units'])) {
            $i = 0;
            foreach ($pdo->query('SELECT ord FROM units ORDER BY ord') as $r) {
                $i++;
                if ((int) $r['ord'] !== $i) {
                    $this->error('E090', "units.ord is not contiguous from 1 (found {$r['ord']} at position {$i}).", 'units.ord');
                    break;
                }
            }
        }

        // Anchors.
        $unitTexts = [];
        $units = isset($missingTables[$legacy ? 'unidades' : 'units']) ? [] : $this->rawRows($doc, 'units', ['id', 'anchor', 'text']);
        foreach ($units as $u) {
            $unitTexts[(string) $u['id']] = Text::length(Text::nfc((string) $u['text']));
        }
        foreach ($units as $u) {
            $this->checkAnchor($u['anchor'], "units[{$u['id']}].anchor", $unitTexts[(string) $u['id']] ?? null, $legacy);
        }
        if (!isset($missingTables[$legacy ? 'fragmentos' : 'fragments'])) {
            foreach ($this->rawRows($doc, 'fragments', ['id', 'unit', 'anchor', 'anchor_end']) as $f) {
                $this->checkAnchor($f['anchor'], "fragments[{$f['id']}].anchor", $unitTexts[(string) $f['unit']] ?? null, $legacy);
                if ($f['anchor_end'] !== null) {
                    $this->checkAnchor($f['anchor_end'], "fragments[{$f['id']}].anchor_end", null, $legacy);
                }
            }
        }
        if (!isset($missingTables[$legacy ? 'figuras' : 'figures'])) {
            foreach ($this->rawRows($doc, 'figures', ['id', 'unit', 'anchor']) as $f) {
                $this->checkAnchor($f['anchor'], "figures[{$f['id']}].anchor", $unitTexts[(string) $f['unit']] ?? null, $legacy);
            }
        }

        // Spaces and vectors.
        $spaces = [];
        if (!isset($missingTables[$legacy ? 'espacios' : 'spaces'])) {
            foreach ($doc->rows('spaces', '', [], ['id', 'dims', 'dtype']) as $s) {
                $spaces[(string) $s['id']] = $s;
                if (!isset(Vectors::SIZES[(string) $s['dtype']])) {
                    $this->error('E032', "Unknown dtype {$s['dtype']} in space {$s['id']}.", "spaces[{$s['id']}]");
                }
            }
        }
        $vectorCount = 0;
        if (!isset($missingTables[$legacy ? 'vectores' : 'vectors'])) {
            $table = $legacy ? 'vectores' : 'vectors';
            $cols = $legacy ? 'objetivo AS target, id, espacio AS space, length(valores) AS len' : 'target, id, space, length(data) AS len';
            $unknown = [];
            foreach ($pdo->query("SELECT {$cols} FROM {$table} ORDER BY 3, 1, 2") as $v) {
                $vectorCount++;
                $sid = (string) $v['space'];
                $where = "vectors[{$v['target']}/{$v['id']}/{$sid}]";
                if (!isset($spaces[$sid])) {
                    if (!isset($unknown[$sid])) {
                        $this->error('E031', "Vector space {$sid} is not declared in spaces.", $where);
                        $unknown[$sid] = true;
                    }
                    continue;
                }
                $size = Vectors::SIZES[(string) $spaces[$sid]['dtype']] ?? null;
                if ($size !== null && (int) $v['len'] !== (int) $spaces[$sid]['dims'] * $size) {
                    $this->error('E030', "Vector length {$v['len']} bytes; expected {$spaces[$sid]['dims']} x {$size}.", $where);
                }
            }
        }

        // FTS index in sync, checked on a writable temporary copy.
        $ftsTable = $legacy ? 'fragmentos_fts' : 'fragments_fts';
        if ($c->hasTable($ftsTable)) {
            $this->checkFts($c, $ftsTable);
        }

        // Blobs.
        if (!$legacy && !isset($missingTables['blobs'])) {
            foreach ($pdo->query('SELECT key, sha256, data FROM blobs ORDER BY key') as $b) {
                if (strtolower((string) $b['sha256']) !== hash('sha256', (string) $b['data'])) {
                    $this->error('E080', "Blob {$b['key']}: sha256 does not match its data.", "blobs[{$b['key']}]");
                }
            }
        }

        // Integrity (content hash and signature).
        if (isset($meta['content_sha256'])) {
            try {
                $hash = $doc->contentSha256();
            } catch (\Throwable $e) {
                $hash = '';
            }
            if (strtolower((string) $meta['content_sha256']) !== $hash) {
                $this->error('E081', 'content_sha256 does not match the canonical dump.', 'spdf_meta.content_sha256');
            } elseif (isset($meta['signature'])) {
                $this->checkSignature($meta, $hash);
            }
        } elseif (isset($meta['signature']) && !isset($meta['content_sha256'])) {
            $this->error('E082', 'signature present without content_sha256.', 'spdf_meta.signature');
        }

        // Profile warnings.
        if (in_array('semantic', $profile, true) && $vectorCount === 0) {
            $this->warning('W100', "Profile 'semantic' without vectors.");
        }
        if (in_array('media', $profile, true)) {
            $hasTime = false;
            foreach ($units as $u) {
                $a = is_string($u['anchor']) ? json_decode($u['anchor'], true) : null;
                $t = is_array($a) ? ($a['type'] ?? $a['tipo'] ?? null) : null;
                if ($t === 'time' || $t === 'tiempo') {
                    $hasTime = true;
                    break;
                }
            }
            if (!$hasTime) {
                $this->warning('W101', "Profile 'media' without time anchors.");
            }
        }
        if ($nDocs >= 1) {
            $uc = $legacy ? 'unidades' : 'unit_count';
            $declared = (int) $pdo->query("SELECT {$uc} FROM {$docTable} LIMIT 1")->fetchColumn();
            if ($declared !== count($units)) {
                $this->warning('W102', "unit_count is {$declared} but the file has " . count($units) . ' units.');
            }
        }

        return $this->result($legacy ? $c->version : (string) ($meta['spdf_version'] ?? $c->version), $profile);
    }

    /** Rows with the raw (unparsed) JSON text of the requested columns. */
    private function rawRows(Document $doc, string $table, array $cols): array
    {
        $name = $doc->tableName($table);
        if ($name === null) {
            return [];
        }
        $sql = 'SELECT ' . $doc->selectList($table, $cols) . ' FROM ' . Container::quoteIdent($name);
        return $doc->container()->pdo->query($sql)->fetchAll();
    }

    private function checkAnchor(mixed $raw, string $where, ?int $unitLength, bool $legacy): void
    {
        if (!is_string($raw)) {
            $this->error('E040', 'Anchor is not JSON text.', $where);
            return;
        }
        try {
            $a = Json::decode($raw);
        } catch (\JsonException) {
            $this->error('E040', 'Anchor is not valid JSON.', $where);
            return;
        }
        if ($legacy) {
            $a = Legacy::anchor($a);
        }
        if (!is_array($a) || array_is_list($a) || !isset($a['type']) || !is_string($a['type'])) {
            $this->error('E040', 'Anchor is not an object with a string type.', $where);
            return;
        }
        $type = $a['type'];
        if (!in_array($type, self::ANCHOR_TYPES, true)) {
            $this->error('E041', "Unknown anchor type {$type}.", $where);
            return;
        }
        $isInt = fn ($v) => is_int($v);
        $isNum = fn ($v) => is_int($v) || is_float($v);
        $isStr = fn ($v) => is_string($v);
        $ok = match ($type) {
            'page' => isset($a['physical']) && is_int($a['physical']) && $a['physical'] >= 1
                && array_key_exists('printed', $a) && ($a['printed'] === null || is_string($a['printed'])),
            'time' => isset($a['t0'], $a['t1']) && $isNum($a['t0']) && $isNum($a['t1']),
            'section' => isset($a['path']) && is_array($a['path']) && array_is_list($a['path'])
                && array_reduce($a['path'], fn ($c, $x) => $c && is_string($x), true),
            'slide' => isset($a['n']) && $isInt($a['n']),
            'sheet' => isset($a['sheet'], $a['row_from'], $a['row_to']) && $isStr($a['sheet'])
                && $isInt($a['row_from']) && $isInt($a['row_to']),
            'web' => isset($a['url']) && $isStr($a['url']),
            'image' => true,
            'verse' => isset($a['line_from']) && $isInt($a['line_from']),
            'canonical' => isset($a['scheme'], $a['ref']) && $isStr($a['scheme']) && $isStr($a['ref']),
        };
        if (!$ok) {
            $this->error('E040', "Anchor of type {$type} lacks a required member or has a wrong type.", $where);
            return;
        }
        if (array_key_exists('chars', $a)) {
            $ch = $a['chars'];
            if (!is_array($ch) || count($ch) !== 2 || !is_int($ch[0] ?? null) || !is_int($ch[1] ?? null)) {
                $this->error('E040', 'chars must be [start, end] integers.', $where);
                return;
            }
            if ($ch[0] < 0 || $ch[1] < $ch[0] || ($unitLength !== null && $ch[1] > $unitLength)) {
                $this->error('E042', "chars [{$ch[0]}, {$ch[1]}] out of range.", $where);
            }
        }
    }

    private function checkFts(Container $c, string $fts): void
    {
        $src = $c->pdo;
        // Copy the database through SQLite itself (VACUUM INTO works on read-only connections).
        $tmp = tempnam(sys_get_temp_dir(), 'spdfv');
        @unlink($tmp);
        try {
            $src->exec('PRAGMA query_only = 0');
            try {
                $src->exec('VACUUM INTO ' . $src->quote($tmp));
            } finally {
                $src->exec('PRAGMA query_only = 1');
            }
            $copy = new \PDO('sqlite:' . $tmp, null, null, [\PDO::ATTR_ERRMODE => \PDO::ERRMODE_EXCEPTION]);
            $copy->exec('PRAGMA trusted_schema = OFF');
            try {
                $copy->exec("INSERT INTO {$fts}({$fts}, rank) VALUES('integrity-check', 1)");
            } catch (\PDOException $e) {
                $this->error('E070', 'FTS index out of sync with fragments: ' . $e->getMessage(), $fts);
            }
            $copy = null;
        } catch (\PDOException $e) {
            $this->error('E070', 'FTS index cannot be checked: ' . $e->getMessage(), $fts);
        } finally {
            @unlink($tmp);
        }
    }

    private function checkSignature(array $meta, string $hash): void
    {
        $sig = base64_decode((string) $meta['signature'], true);
        $signer = (string) ($meta['signer'] ?? '');
        $key = str_starts_with($signer, 'ed25519:') ? base64_decode(substr($signer, 8), true) : false;
        if ($sig === false || $key === false || strlen($key) !== 32 || strlen($sig) !== 64) {
            $this->error('E082', 'Malformed signature or signer.', 'spdf_meta.signature');
            return;
        }
        if (!function_exists('sodium_crypto_sign_verify_detached')) {
            $this->warning('W106', 'Signature not verified: ext-sodium is not available.');
            return;
        }
        if (!sodium_crypto_sign_verify_detached($sig, 'spdf-content-sha256:' . $hash, $key)) {
            $this->error('E082', 'The signature does not verify.', 'spdf_meta.signature');
        }
    }
}
