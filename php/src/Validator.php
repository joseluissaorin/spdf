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
            $this->error($e->spdfCode === 'E002' ? 'E002' : 'E001', $e->getMessage());
            return $this->result(null, []);
        } catch (\Throwable $e) {
            $this->error('E001', $e->getMessage());
            return $this->result(null, []);
        }
        try {
            return $this->checks($c);
        } finally {
            $c->close();
        }
    }

    private function checks(Container $c): array
    {
        $pdo = $c->pdo;
        $version = $c->version;
        $profile = [];
        if ($c->legacy) {
            $this->warning('W110', "Legacy SPDF {$version} file.");
            foreach (['spdf', 'documentos', 'unidades', 'fragmentos', 'fragmentos_fts'] as $t) {
                if (!$c->hasTable($t)) {
                    $this->error('E010', "Missing legacy table {$t}.", $t);
                }
            }
            foreach ($c->forbidden as $f) {
                $this->error('E020', "{$f['type']} {$f['name']} present.", $f['name']);
            }
            return $this->result($version, $profile);
        }
        if ($c->gzipped) {
            $this->warning('E003', 'SPDF 5.0 should not be gzip-wrapped.');
        }
        if ($version !== '5.0') {
            $this->warning('W105', "Newer minor version {$version}.");
        }
        foreach ($c->forbidden as $f) {
            $this->error('E020', "{$f['type']} {$f['name']} present.", $f['name']);
        }

        // Required tables and columns.
        $present = [];
        foreach (self::REQUIRED_TABLES as $t) {
            if (!$c->hasTable($t)) {
                $this->error('E010', "Missing table {$t}.", $t);
                continue;
            }
            $have = $c->columns($t);
            $present[$t] = $have;
            foreach (Document::COLUMNS[$t] ?? [] as $col) {
                if (!in_array($col, $have, true)) {
                    $this->error('E011', "Missing column {$t}.{$col}.", "{$t}.{$col}");
                }
            }
        }
        $ok = function (string $t, string ...$cols) use ($present): bool {
            if (!isset($present[$t])) {
                return false;
            }
            foreach ($cols as $col) {
                if (!in_array($col, $present[$t], true)) {
                    return false;
                }
            }
            return true;
        };

        $meta = [];
        if ($ok('spdf_meta', 'key', 'value')) {
            foreach ($pdo->query('SELECT key, value FROM spdf_meta') as $r) {
                $meta[(string) $r['key']] = $r['value'];
            }
            foreach (self::REQUIRED_META as $k) {
                if (!array_key_exists($k, $meta)) {
                    $this->error('E012', "Missing spdf_meta key {$k}.", $k);
                }
            }
            $profile = array_values(array_filter(preg_split('/\s+/', (string) ($meta['profile'] ?? '')) ?: [], fn ($x) => $x !== ''));
        }

        $docs = [];
        if ($ok('documents', 'id', 'metadata')) {
            $docs = $ok('documents', 'rights', 'unit_count')
                ? $pdo->query('SELECT id, metadata, rights, unit_count FROM documents')->fetchAll()
                : $pdo->query('SELECT id, metadata, NULL AS rights, NULL AS unit_count FROM documents')->fetchAll();
            if (count($docs) !== 1) {
                $this->error('E013', 'documents has ' . count($docs) . ' rows.', 'documents');
            }
            foreach ($docs as $d) {
                try {
                    if (!is_string($d['metadata'])) {
                        throw new \JsonException('not text');
                    }
                    $m = Json::decode($d['metadata']);
                    if (!is_array($m) || (array_is_list($m) && $m !== []) || !is_string($m['type'] ?? null) || !is_string($m['title'] ?? null)) {
                        $this->error('E051', 'Metadata needs a string type and title.', (string) $d['id']);
                    }
                } catch (\JsonException) {
                    $this->error('E050', 'Metadata is not valid JSON.', (string) $d['id']);
                }
                if ($d['rights'] !== null) {
                    try {
                        Json::decode((string) $d['rights']);
                    } catch (\JsonException) {
                        $this->error('E050', 'rights is not valid JSON.', (string) $d['id']);
                    }
                }
            }
        }

        if ($ok('extensions', 'name', 'required')) {
            foreach ($pdo->query('SELECT name, required FROM extensions ORDER BY name') as $e) {
                if ($e['required'] && !in_array($e['name'], Document::KNOWN_EXTENSIONS, true)) {
                    $this->error('E060', "Unknown required extension {$e['name']}.", (string) $e['name']);
                }
            }
        }

        $texts = [];
        $unitAnchors = [];
        if ($ok('units', 'id', 'ord', 'anchor', 'text')) {
            $rows = $pdo->query('SELECT id, ord, anchor, text FROM units ORDER BY ord, id')->fetchAll();
            foreach ($rows as $i => $r) {
                if ($r['ord'] !== $i + 1) {
                    $this->error('E090', 'units.ord is not 1..N.', 'units');
                    break;
                }
            }
            if (count($docs) === 1 && $docs[0]['unit_count'] !== null && (int) $docs[0]['unit_count'] !== count($rows)) {
                $this->warning('W102', "unit_count {$docs[0]['unit_count']} but " . count($rows) . ' units.', 'documents.unit_count');
            }
            foreach ($rows as $r) {
                $texts[(string) $r['id']] = $r['text'];
                $unitAnchors[] = $r['anchor'];
                $this->anchorError($r['anchor'], is_string($r['text']) ? $r['text'] : null, "units/{$r['id']}");
            }
        }
        if ($ok('fragments', 'id', 'unit', 'anchor')) {
            $endCol = $ok('fragments', 'anchor_end') ? 'anchor_end' : 'NULL AS anchor_end';
            foreach ($pdo->query("SELECT id, unit, anchor, {$endCol} FROM fragments ORDER BY n") as $f) {
                $this->anchorError($f['anchor'], $texts[(string) $f['unit']] ?? null, "fragments/{$f['id']}");
                if ($f['anchor_end'] !== null) {
                    $this->anchorError($f['anchor_end'], null, "fragments/{$f['id']}/anchor_end");
                }
            }
        }
        if ($ok('figures', 'id', 'unit', 'anchor')) {
            foreach ($pdo->query('SELECT id, unit, anchor FROM figures ORDER BY id') as $g) {
                $this->anchorError($g['anchor'], $texts[(string) $g['unit']] ?? null, "figures/{$g['id']}");
            }
        }

        $spaces = [];
        if ($ok('spaces', 'id', 'dims', 'dtype')) {
            foreach ($pdo->query('SELECT id, dims, dtype FROM spaces ORDER BY id') as $sp) {
                $spaces[(string) $sp['id']] = [(int) $sp['dims'], (string) $sp['dtype']];
                if (!isset(Vectors::SIZES[(string) $sp['dtype']])) {
                    $this->error('E032', "Unknown dtype {$sp['dtype']}.", (string) $sp['id']);
                }
            }
        }
        $nvec = 0;
        if ($ok('vectors', 'target', 'id', 'space', 'data')) {
            foreach ($pdo->query('SELECT target, id, space, typeof(data) AS t, length(data) AS len FROM vectors ORDER BY space, target, id') as $v) {
                $nvec++;
                $where = "vectors/{$v['space']}/{$v['target']}/{$v['id']}";
                if (!isset($spaces[(string) $v['space']])) {
                    $this->error('E031', "Unknown space {$v['space']}.", $where);
                    continue;
                }
                [$dims, $dtype] = $spaces[(string) $v['space']];
                if (!isset(Vectors::SIZES[$dtype])) {
                    continue;
                }
                if ($v['t'] !== 'blob' || (int) $v['len'] !== $dims * Vectors::SIZES[$dtype]) {
                    $this->error('E030', "Vector length {$v['len']} != {$dims} x " . Vectors::SIZES[$dtype] . '.', $where);
                }
            }
        }

        if ($c->hasTable('fragments_fts')) {
            $this->checkFts($c, 'fragments_fts', $c->hasTable('fragments_fts_trigram'));
        }

        if ($ok('blobs', 'key', 'sha256', 'data')) {
            foreach ($pdo->query('SELECT key, sha256, data FROM blobs ORDER BY key') as $b) {
                if (hash('sha256', (string) $b['data']) !== $b['sha256']) {
                    $this->error('E080', 'Blob sha256 mismatch.', (string) $b['key']);
                }
            }
        }

        if (array_key_exists('content_sha256', $meta) && $this->errors === []) {
            try {
                $actual = Document::fromContainer($c)->contentSha256();
            } catch (\Throwable $e) {
                $actual = 'unavailable';
            }
            if ($actual !== $meta['content_sha256']) {
                $this->error('E081', 'content_sha256 does not match the canonical dump.', 'spdf_meta.content_sha256');
            } elseif (array_key_exists('signature', $meta)) {
                $this->checkSignature($meta, (string) $meta['content_sha256']);
            }
        }

        if (in_array('semantic', $profile, true) && $nvec === 0) {
            $this->warning('W100', 'Profile semantic without vectors.');
        }
        if (in_array('media', $profile, true) && $ok('units', 'anchor')) {
            $hasTime = false;
            foreach ($pdo->query('SELECT anchor FROM units') as $r) {
                $a = is_string($r['anchor']) ? json_decode($r['anchor'], true) : null;
                if (is_array($a) && ($a['type'] ?? null) === 'time') {
                    $hasTime = true;
                    break;
                }
            }
            if (!$hasTime) {
                $this->warning('W101', 'Profile media without time anchors.');
            }
        }
        return $this->result($version, $profile);
    }

    private function anchorError(mixed $raw, ?string $text, string $where): void
    {
        if (!is_string($raw)) {
            $this->error('E040', 'Anchor is not valid JSON.', $where);
            return;
        }
        try {
            $a = Json::decode($raw);
        } catch (\JsonException) {
            $this->error('E040', 'Anchor is not valid JSON.', $where);
            return;
        }
        $r = self::checkAnchor($a, $text);
        if ($r !== null) {
            $this->error($r[0], $r[1], $where);
        }
    }

    /**
     * Checks one decoded anchor. Returns null if fine, else [code, message].
     *
     * @return array{0:string,1:string}|null
     */
    public static function checkAnchor(mixed $a, ?string $text): ?array
    {
        if (!is_array($a) || (array_is_list($a) && $a !== [])) {
            return ['E040', 'Anchor is not an object.'];
        }
        $t = $a['type'] ?? null;
        if (!is_string($t)) {
            return ['E040', 'Anchor without type.'];
        }
        if (!in_array($t, self::ANCHOR_TYPES, true)) {
            return ['E041', "Unknown anchor type {$t}."];
        }
        $isInt = fn ($v) => is_int($v);
        $isNum = fn ($v) => is_int($v) || is_float($v);
        $ok = match ($t) {
            'page' => $isInt($a['physical'] ?? null) && $a['physical'] >= 1 && array_key_exists('printed', $a)
                && ($a['printed'] === null || is_string($a['printed'])),
            'time' => $isNum($a['t0'] ?? null) && $isNum($a['t1'] ?? null) && 0 <= $a['t0'] && $a['t0'] <= $a['t1'],
            'section' => is_array($a['path'] ?? null) && (array_is_list($a['path']))
                && array_reduce($a['path'], fn ($c, $x) => $c && is_string($x), true),
            'slide' => $isInt($a['n'] ?? null) && $a['n'] >= 1,
            'sheet' => is_string($a['sheet'] ?? null) && $isInt($a['row_from'] ?? null) && $isInt($a['row_to'] ?? null),
            'web' => is_string($a['url'] ?? null),
            'image' => true,
            'verse' => $isInt($a['line_from'] ?? null),
            'canonical' => is_string($a['scheme'] ?? null) && is_string($a['ref'] ?? null),
        };
        if (!$ok) {
            return ['E040', "{$t} anchor misses or mistypes a required member."];
        }
        if (array_key_exists('region', $a)) {
            $r = $a['region'];
            if (!is_array($r) || !$isNum($r['x'] ?? null) || !$isNum($r['y'] ?? null) || !$isNum($r['w'] ?? null) || !$isNum($r['h'] ?? null)) {
                return ['E040', 'Bad region.'];
            }
        }
        if (array_key_exists('chars', $a)) {
            $ch = $a['chars'];
            if (!is_array($ch) || !array_is_list($ch) || count($ch) !== 2 || !$isInt($ch[0]) || !$isInt($ch[1])) {
                return ['E040', 'Bad chars.'];
            }
            if ($text !== null && !(0 <= $ch[0] && $ch[0] <= $ch[1] && $ch[1] <= Text::length(Text::nfc($text)))) {
                return ['E042', "chars [{$ch[0]}, {$ch[1]}] out of range."];
            }
        }
        return null;
    }

    private function checkFts(Container $c, string $fts, bool $trigram = false): void
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
                if ($trigram) {
                    $copy->exec("INSERT INTO fragments_fts_trigram(fragments_fts_trigram, rank) VALUES('integrity-check', 1)");
                }
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
