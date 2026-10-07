<?php

declare(strict_types=1);

namespace Spdf;

/**
 * A SPDF file opened for reading: SPDF 5.0, or legacy 4.x seen through the 5.0 view.
 *
 * ```php
 * $doc = Spdf\Document::open('quijote.spdf');
 * foreach ($doc->searchLexical('molinos de viento', 5) as $hit) {
 *     echo $doc->cite($hit['anchor'], null, 'es'), "\n";
 * }
 * ```
 */
final class Document
{
    /** Columns of each 5.0 table, in dump order. */
    public const COLUMNS = [
        'spdf_meta' => ['key', 'value'],
        'documents' => ['id', 'kind', 'metadata', 'source_sha256', 'source_ref', 'mime', 'bytes', 'unit_count',
            'duration', 'created', 'updated', 'title', 'authors', 'year', 'language', 'rights'],
        'units' => ['id', 'document', 'ord', 'anchor', 'text', 'notes', 'header', 'footer', 'image', 'thumbnail',
            'reader', 'confidence', 'printed', 't0', 't1', 'words'],
        'sections' => ['id', 'document', 'parent', 'level', 'title', 'unit_from', 'unit_to', 'summary'],
        'fragments' => ['n', 'id', 'document', 'unit', 'ord', 'text', 'context', 'section', 'anchor', 'anchor_end',
            'search_text'],
        'figures' => ['id', 'document', 'unit', 'image', 'caption', 'description', 'anchor'],
        'spaces' => ['id', 'provider', 'model', 'version', 'dims', 'dtype', 'normalized', 'truncated_from',
            'modalities', 'task_prefixes', 'created'],
        'vectors' => ['target', 'id', 'space', 'document', 'data'],
        'blobs' => ['key', 'mime', 'sha256', 'data'],
        'provenance' => ['document', 'stage', 'provider', 'model', 'detail', 'ms', 'at'],
        'extensions' => ['name', 'version', 'required'],
    ];

    /** JSON-in-TEXT columns. */
    public const JSON_COLUMNS = [
        'documents' => ['metadata', 'rights'],
        'units' => ['anchor', 'notes', 'words'],
        'fragments' => ['section', 'anchor', 'anchor_end'],
        'figures' => ['anchor'],
        'spaces' => ['modalities', 'task_prefixes'],
        'provenance' => ['detail'],
    ];

    /** Extensions this implementation understands (none yet). */
    public const KNOWN_EXTENSIONS = [];

    private Container $c;
    /** @var array<string,true>|null */
    private ?array $blobKeys = null;
    private ?array $documentRow = null;
    /** @var array<int,array>|null fragment rows by n */
    private ?array $fragmentsByN = null;

    private function __construct(Container $c)
    {
        $this->c = $c;
    }

    /** Opens a file safely (read-only, no triggers or views, bounded sizes). */
    public static function open(string $path, ?Options $options = null): self
    {
        $c = Container::open($path, $options, true);
        $doc = new self($c);
        try {
            $doc->checkExtensions();
        } catch (\Throwable $e) {
            $c->close();
            throw $e;
        }
        return $doc;
    }

    /** @internal Wraps an already opened container (used by the validator). */
    public static function fromContainer(Container $c): self
    {
        return new self($c);
    }

    public function close(): void
    {
        $this->c->close();
    }

    public function version(): string
    {
        return $this->c->version;
    }

    public function isLegacy(): bool
    {
        return $this->c->legacy;
    }

    public function wasGzipped(): bool
    {
        return $this->c->gzipped;
    }

    public function container(): Container
    {
        return $this->c;
    }

    // ------------------------------------------------------------------
    // Rows through the 5.0 view
    // ------------------------------------------------------------------

    /** Physical name of a 5.0 table in this file (legacy name for 4.x), or null. */
    public function tableName(string $table): ?string
    {
        if ($this->c->legacy) {
            $name = Legacy::TABLES[$table][0] ?? null;
        } else {
            $name = $table;
        }
        return $name !== null && $this->c->hasTable($name) ? $name : null;
    }

    /** SELECT list exposing the 5.0 columns of a table (missing columns as NULL). */
    public function selectList(string $table, ?array $only = null): string
    {
        $name = $this->tableName($table);
        $existing = $name === null ? [] : $this->c->columns($name);
        $parts = [];
        foreach (self::COLUMNS[$table] as $col) {
            if ($only !== null && !in_array($col, $only, true)) {
                continue;
            }
            if ($this->c->legacy) {
                $old = Legacy::legacyColumn($table, $col);
                $expr = $old !== null && in_array($old, $existing, true)
                    ? Container::quoteIdent($old)
                    : (Legacy::DEFAULTS["{$table}.{$col}"] ?? 'NULL');
            } else {
                $expr = in_array($col, $existing, true) ? Container::quoteIdent($col) : 'NULL';
            }
            $parts[] = "{$expr} AS " . Container::quoteIdent($col);
        }
        return implode(', ', $parts);
    }

    /**
     * Runs a query over a 5.0 table through the view. `$tail` may use 5.0 column
     * names wrapped as {col}; they are replaced by the physical names.
     */
    public function rows(string $table, string $tail = '', array $params = [], ?array $only = null): array
    {
        $name = $this->tableName($table);
        if ($name === null) {
            return [];
        }
        $sql = 'SELECT ' . $this->selectList($table, $only) . ' FROM ' . Container::quoteIdent($name);
        if ($tail !== '') {
            $sql .= ' ' . $this->physical($table, $tail);
        }
        $st = $this->c->pdo->prepare($sql);
        $st->execute($params);
        $out = [];
        while (($r = $st->fetch()) !== false) {
            $out[] = $this->mapRow($table, $r);
        }
        return $out;
    }

    /** Replaces {col} placeholders by the physical column names. */
    public function physical(string $table, string $sql): string
    {
        return preg_replace_callback('/\{([a-z_0-9]+)\}/', function ($m) use ($table) {
            $col = $m[1];
            if ($this->c->legacy) {
                $old = Legacy::legacyColumn($table, $col);
                return $old === null ? 'NULL' : Container::quoteIdent($old);
            }
            return Container::quoteIdent($col);
        }, $sql) ?? $sql;
    }

    private function decodeJson(mixed $v): mixed
    {
        if (!is_string($v)) {
            return $v;
        }
        try {
            return Json::decode($v);
        } catch (\JsonException) {
            return $v;
        }
    }

    /** Parses JSON columns and applies the legacy value mapping. */
    private function mapRow(string $table, array $r): array
    {
        foreach (self::JSON_COLUMNS[$table] ?? [] as $col) {
            if (array_key_exists($col, $r)) {
                $r[$col] = $this->decodeJson($r[$col]);
            }
        }
        if (!$this->c->legacy) {
            return $r;
        }
        switch ($table) {
            case 'spdf_meta':
                $r['key'] = Legacy::metaKey((string) $r['key']);
                break;
            case 'documents':
                $tipo = $r['kind'] ?? null;
                $r['kind'] = Legacy::kind($tipo);
                if (array_key_exists('metadata', $r)) {
                    $r['metadata'] = Legacy::metadata($r['metadata'], $tipo);
                }
                if (array_key_exists('source_ref', $r)) {
                    $r['source_ref'] = Legacy::reference($r['source_ref'], $this->blobKeys());
                }
                break;
            case 'units':
                foreach (['image', 'thumbnail'] as $k) {
                    if (array_key_exists($k, $r)) {
                        $r[$k] = Legacy::reference($r[$k], $this->blobKeys());
                    }
                }
                if (array_key_exists('anchor', $r)) {
                    $r['anchor'] = Legacy::anchor($r['anchor']);
                }
                break;
            case 'fragments':
                foreach (['anchor', 'anchor_end'] as $k) {
                    if (array_key_exists($k, $r)) {
                        $r[$k] = Legacy::anchor($r[$k]);
                    }
                }
                break;
            case 'figures':
                if (array_key_exists('image', $r)) {
                    $r['image'] = Legacy::reference($r['image'], $this->blobKeys(), true);
                }
                if (array_key_exists('anchor', $r)) {
                    $r['anchor'] = Legacy::anchor($r['anchor']);
                }
                break;
            case 'spaces':
                if (array_key_exists('modalities', $r)) {
                    $r['modalities'] = Legacy::modalities($r['modalities']);
                }
                break;
            case 'vectors':
                if (isset($r['target'])) {
                    $r['target'] = Legacy::target((string) $r['target']);
                }
                break;
        }
        return $r;
    }

    /** @return array<string,true> */
    private function blobKeys(): array
    {
        if ($this->blobKeys === null) {
            $this->blobKeys = [];
            $name = $this->tableName('blobs');
            if ($name !== null) {
                $col = $this->c->legacy ? 'clave' : 'key';
                foreach ($this->c->pdo->query('SELECT ' . Container::quoteIdent($col) . ' FROM ' . Container::quoteIdent($name)) as $r) {
                    $this->blobKeys[(string) $r[$col]] = true;
                }
            }
        }
        return $this->blobKeys;
    }

    // ------------------------------------------------------------------
    // Public reading API
    // ------------------------------------------------------------------

    /** spdf_meta as key => value. @return array<string,string> */
    public function meta(): array
    {
        $out = [];
        foreach ($this->rows('spdf_meta') as $r) {
            $out[(string) $r['key']] = $r['value'];
        }
        return $out;
    }

    /** The document row (5.0 view; metadata and rights parsed). */
    public function document(): array
    {
        if ($this->documentRow === null) {
            $rows = $this->rows('documents', 'ORDER BY {id} LIMIT 2');
            if (count($rows) !== 1) {
                throw new SpdfException('E013', 'documents must hold exactly one row.');
            }
            $this->documentRow = $rows[0];
        }
        return $this->documentRow;
    }

    /** The CSL-JSON item with the `spdf` extension object. */
    public function metadata(): array
    {
        $m = $this->document()['metadata'] ?? [];
        return is_array($m) ? $m : [];
    }

    public function title(): ?string
    {
        $m = $this->metadata();
        return isset($m['title']) && is_string($m['title']) ? $m['title'] : ($this->document()['title'] ?? null);
    }

    /** Portable document reference for anchor URIs: `sha256-<hex>` (or the id). */
    public function docref(): string
    {
        $d = $this->document();
        $h = strtolower((string) ($d['source_sha256'] ?? ''));
        return preg_match('/^[0-9a-f]{64}$/', $h) ? 'sha256-' . $h : (string) $d['id'];
    }

    /** Units in reading order (`ord` is 1-based; legacy units are renumbered). */
    public function units(): array
    {
        if ($this->c->legacy) {
            $rows = $this->rows('units', 'ORDER BY {ord}, {id}');
            foreach ($rows as $i => &$r) {
                $r['ord'] = $i + 1;
            }
            unset($r);
            return $rows;
        }
        return $this->rows('units', 'ORDER BY {ord}, {id}');
    }

    public function unit(string $id): ?array
    {
        foreach ($this->units() as $u) {
            if ($u['id'] === $id) {
                return $u;
            }
        }
        return null;
    }

    /** The unit whose printed folio is `$printed` ("go to page 145"). */
    public function unitByPrinted(string $printed): ?array
    {
        foreach ($this->units() as $u) {
            if (($u['printed'] ?? null) === $printed) {
                return $u;
            }
        }
        return null;
    }

    public function sections(): array
    {
        return $this->rows('sections', 'ORDER BY {id}');
    }

    public function fragments(): array
    {
        return $this->rows('fragments', 'ORDER BY {n}');
    }

    public function fragment(string $id): ?array
    {
        $rows = $this->rows('fragments', 'WHERE {id} = ?', [$id]);
        return $rows[0] ?? null;
    }

    public function fragmentByN(int $n): ?array
    {
        if ($this->fragmentsByN === null) {
            $this->fragmentsByN = [];
            foreach ($this->rows('fragments', 'ORDER BY {n}', [], ['n', 'id', 'unit', 'anchor', 'anchor_end']) as $r) {
                $this->fragmentsByN[(int) $r['n']] = $r;
            }
        }
        return $this->fragmentsByN[$n] ?? null;
    }

    public function figures(): array
    {
        return $this->rows('figures', 'ORDER BY {id}');
    }

    public function spaces(): array
    {
        return $this->rows('spaces', 'ORDER BY {id}');
    }

    public function space(string $id): ?array
    {
        return $this->rows('spaces', 'WHERE {id} = ?', [$id])[0] ?? null;
    }

    /**
     * Decoded vectors of a space and target.
     *
     * @return array<string,list<float>> id => components
     */
    public function vectors(string $space, string $target = 'fragment'): array
    {
        $sp = $this->space($space);
        if ($sp === null) {
            throw new SpdfException('E031', "Unknown vector space: {$space}");
        }
        $t = $this->c->legacy ? Legacy::legacyTarget($target) : $target;
        $out = [];
        foreach ($this->rows('vectors', 'WHERE {space} = ? AND {target} = ? ORDER BY {id}', [$space, $t], ['id', 'data']) as $r) {
            $out[(string) $r['id']] = Vectors::decode((string) $r['data'], (string) $sp['dtype']);
        }
        return $out;
    }

    /** Blob descriptors (sha256 computed from the data). */
    public function blobs(): array
    {
        $name = $this->tableName('blobs');
        if ($name === null) {
            return [];
        }
        $out = [];
        $st = $this->c->pdo->query('SELECT ' . $this->selectList('blobs', ['key', 'mime', 'data'])
            . ' FROM ' . Container::quoteIdent($name) . ' ORDER BY ' . $this->physical('blobs', '{key}'));
        while (($r = $st->fetch()) !== false) {
            $data = (string) $r['data'];
            $out[] = ['key' => $r['key'], 'mime' => $r['mime'], 'bytes' => strlen($data), 'sha256' => hash('sha256', $data)];
        }
        return $out;
    }

    /** Bytes of a blob (`key` or `blob:key`), or null. */
    public function blob(string $key): ?string
    {
        if (str_starts_with($key, 'blob:')) {
            $key = substr($key, 5);
        }
        $r = $this->rows('blobs', 'WHERE {key} = ?', [$key], ['data']);
        return $r === [] ? null : (string) $r[0]['data'];
    }

    public function provenance(): array
    {
        return $this->rows('provenance', 'ORDER BY {at}, {stage}, {provider}, {model}, {detail}, {ms}');
    }

    public function extensions(): array
    {
        return $this->rows('extensions', 'ORDER BY {name}');
    }

    private function checkExtensions(): void
    {
        foreach ($this->extensions() as $e) {
            if ((int) ($e['required'] ?? 0) !== 0 && !in_array($e['name'], self::KNOWN_EXTENSIONS, true)) {
                throw new SpdfException('E060', "The file requires the unknown extension {$e['name']}.");
            }
        }
    }

    /** {"tokenizer": ..., "trigram": bool} of the lexical index. */
    public function fts(): array
    {
        $name = $this->c->legacy ? 'fragmentos_fts' : 'fragments_fts';
        $sql = $this->c->pdo->query("SELECT sql FROM sqlite_master WHERE name = " . $this->c->pdo->quote($name))->fetchColumn();
        $tok = null;
        if (is_string($sql) && preg_match('/tokenize\s*=\s*(?:\'((?:[^\']|\'\')*)\'|"((?:[^"]|"")*)")/i', $sql, $m)) {
            $tok = isset($m[2]) && $m[2] !== '' ? str_replace('""', '"', $m[2]) : str_replace("''", "'", $m[1]);
        } elseif (is_string($sql)) {
            $tok = 'unicode61';
        }
        return ['tokenizer' => $tok, 'trigram' => $this->c->hasTable('fragments_fts_trigram')];
    }

    // ------------------------------------------------------------------
    // Canonical dump (contract §5)
    // ------------------------------------------------------------------

    /** The canonical dump as a PHP structure. */
    public function dump(): array
    {
        $doc = $this->document();
        $document = [];
        foreach (self::COLUMNS['documents'] as $col) {
            $document[$col] = $doc[$col] ?? null;
        }
        $strip = function (array $rows, array $drop = ['document']): array {
            return array_map(function ($r) use ($drop) {
                foreach ($drop as $d) {
                    unset($r[$d]);
                }
                return $r;
            }, $rows);
        };
        $meta = $this->meta();
        $out = [
            'spdf_version' => $this->c->legacy ? ($meta['spdf_version'] ?? $this->c->version) : ($meta['spdf_version'] ?? null),
            'meta' => $meta === [] ? new \stdClass() : $meta,
            'fts' => $this->fts(),
            'document' => $document,
            'units' => $strip($this->units()),
            'sections' => $strip($this->sections()),
            'fragments' => $strip($this->fragments()),
            'figures' => $strip($this->figures()),
            'spaces' => $this->spaces(),
            'vectors' => $this->vectorDigests(),
            'blobs' => $this->blobs(),
            'provenance' => $strip($this->provenance()),
            'extensions' => $this->extensions(),
        ];
        if ($this->c->legacy) {
            $out['legacy'] = true;
        }
        return $out;
    }

    /** The canonical dump serialized as JCS. */
    public function dumpJson(): string
    {
        return Json::canonical($this->dump());
    }

    /** Lowercase hex SHA-256 of the JCS dump without content_sha256/signature/signer (§8). */
    public function contentSha256(): string
    {
        $d = $this->dump();
        if (is_array($d['meta'])) {
            unset($d['meta']['content_sha256'], $d['meta']['signature'], $d['meta']['signer']);
            if ($d['meta'] === []) {
                $d['meta'] = new \stdClass();
            }
        }
        return hash('sha256', Json::canonical($d));
    }

    /** @return array<string,array{count:int,sha256:string}>|\stdClass */
    private function vectorDigests(): array|\stdClass
    {
        $name = $this->tableName('vectors');
        if ($name === null) {
            return new \stdClass();
        }
        $sql = 'SELECT ' . $this->selectList('vectors', ['target', 'id', 'space', 'data']) . ' FROM ' . Container::quoteIdent($name)
            . ' ORDER BY ' . $this->physical('vectors', '{space}, {target}, {id}');
        $out = [];
        $ctx = [];
        $count = [];
        foreach ($this->c->pdo->query($sql) as $r) {
            $s = (string) $r['space'];
            if (!isset($ctx[$s])) {
                $ctx[$s] = hash_init('sha256');
                $count[$s] = 0;
            }
            hash_update($ctx[$s], (string) $r['data']);
            $count[$s]++;
        }
        foreach ($ctx as $s => $h) {
            $out[$s] = ['count' => $count[$s], 'sha256' => hash_final($h)];
        }
        return $out === [] ? new \stdClass() : $out;
    }

    // ------------------------------------------------------------------
    // Search (contract §6)
    // ------------------------------------------------------------------

    /** Reference lexical search. @return list<array> */
    public function searchLexical(string $query, int $limit = 10): array
    {
        return (new Search($this))->lexical($query, $limit);
    }

    /** Reference vector search. @param list<float> $vector @return list<array> */
    public function searchVector(array $vector, string $space, int $limit = 10, string $target = 'fragment'): array
    {
        return (new Search($this))->vector($vector, $space, $limit, $target);
    }

    /** Hybrid search (RRF, k = 10). @param list<float> $vector @return list<array> */
    public function searchHybrid(string $query, array $vector, string $space, int $limit = 10): array
    {
        return (new Search($this))->hybrid($query, $vector, $space, $limit);
    }

    // ------------------------------------------------------------------
    // Anchors, citations, exports
    // ------------------------------------------------------------------

    /** Anchor URI of an anchor in this document. */
    public function anchorUri(array $anchor, ?array $anchorEnd = null): string
    {
        return AnchorUri::fromAnchor($this->docref(), $anchor, $anchorEnd);
    }

    /** Short author-date citation of an anchor, e.g. "(Cervantes, 1605, p. 45)". */
    public function cite(array $anchor, ?array $anchorEnd = null, string $locale = 'es'): string
    {
        return Cite::short($this->metadata(), $anchor, $anchorEnd, $locale);
    }

    /** Short citation of a fragment by id. */
    public function citeFragment(string $fragmentId, string $locale = 'es'): string
    {
        $f = $this->fragment($fragmentId) ?? throw new SpdfException('E040', "Unknown fragment: {$fragmentId}");
        return $this->cite((array) $f['anchor'], is_array($f['anchor_end']) ? $f['anchor_end'] : null, $locale);
    }

    /** CSL-JSON item (with `id`; the `spdf` extension removed unless asked). */
    public function cslItem(bool $withExtension = false): array
    {
        return Bibliography::cslItem($this->metadata(), (string) $this->document()['id'], $withExtension);
    }

    /** CSL-JSON array (what Zotero, Pandoc and citeproc import). */
    public function cslJson(bool $pretty = true): string
    {
        return Json::encode([$this->cslItem()], $pretty);
    }

    public function bibtex(): string
    {
        return Bibliography::bibtex($this->cslItem());
    }
}
