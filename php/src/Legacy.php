<?php

declare(strict_types=1);

namespace Spdf;

/**
 * Legacy SPDF 4.x (Scholaris, Spanish identifiers) mapped to the 5.0 view (contract §7).
 */
final class Legacy
{
    /** 5.0 table => [legacy table, [5.0 column => legacy column]] */
    public const TABLES = [
        'spdf_meta' => ['spdf', ['key' => 'clave', 'value' => 'valor']],
        'documents' => ['documentos', [
            'id' => 'id', 'kind' => 'tipo', 'metadata' => 'metadatos', 'source_sha256' => 'huella',
            'source_ref' => 'original', 'mime' => 'mime', 'bytes' => 'bytes', 'unit_count' => 'unidades',
            'duration' => 'duracion', 'created' => 'creado', 'updated' => 'actualizado', 'title' => 'titulo',
            'authors' => 'autores', 'year' => 'anio', 'language' => 'idioma', 'rights' => null,
        ]],
        'units' => ['unidades', [
            'id' => 'id', 'document' => 'documento', 'ord' => 'orden', 'anchor' => 'ancla', 'text' => 'texto',
            'notes' => 'notas', 'header' => 'cabecera', 'footer' => 'pie', 'image' => 'imagen',
            'thumbnail' => 'miniatura', 'reader' => 'lector', 'confidence' => 'confianza', 'printed' => 'impresa',
            't0' => 't0', 't1' => 't1', 'words' => 'palabras',
        ]],
        'sections' => ['secciones', [
            'id' => 'id', 'document' => 'documento', 'parent' => 'padre', 'level' => 'nivel', 'title' => 'titulo',
            'unit_from' => 'unidad_desde', 'unit_to' => 'unidad_hasta', 'summary' => 'resumen',
        ]],
        'fragments' => ['fragmentos', [
            'n' => 'n', 'id' => 'id', 'document' => 'documento', 'unit' => 'unidad', 'ord' => 'orden',
            'text' => 'texto', 'context' => 'contexto', 'section' => 'seccion', 'anchor' => 'ancla',
            'anchor_end' => 'ancla_fin', 'search_text' => 'texto_busqueda',
        ]],
        'figures' => ['figuras', [
            'id' => 'id', 'document' => 'documento', 'unit' => 'unidad', 'image' => 'imagen', 'caption' => 'pie',
            'description' => 'descripcion', 'anchor' => 'ancla',
        ]],
        'spaces' => ['espacios', [
            'id' => 'id', 'provider' => 'proveedor', 'model' => 'modelo', 'version' => 'version', 'dims' => 'dims',
            'dtype' => null, 'normalized' => 'normalizado', 'truncated_from' => null, 'modalities' => 'modalidades',
            'task_prefixes' => null, 'created' => 'creado',
        ]],
        'vectors' => ['vectores', [
            'target' => 'objetivo', 'id' => 'id', 'space' => 'espacio', 'document' => 'documento', 'data' => 'valores',
        ]],
        'blobs' => ['blobs', ['key' => 'clave', 'mime' => 'mime', 'sha256' => null, 'data' => 'datos']],
        'provenance' => ['procedencia', [
            'document' => 'documento', 'stage' => 'fase', 'provider' => 'proveedor', 'model' => 'modelo',
            'detail' => 'detalle', 'ms' => 'ms', 'at' => 'cuando',
        ]],
        'extensions' => [null, ['name' => null, 'version' => null, 'required' => null]],
    ];

    /** Defaults for 5.0 columns absent from legacy tables. */
    public const DEFAULTS = ['spaces.dtype' => "'f32'"];

    public const KINDS = [
        'pdf_escaneado' => 'scanned_pdf', 'fotos' => 'photos', 'imagen' => 'image', 'documento' => 'document',
        'presentacion' => 'slides', 'hoja' => 'sheet',
    ];

    public const TARGETS = ['fragmento' => 'fragment', 'unidad' => 'unit', 'figura' => 'figure'];

    public const ANCHOR_TYPES = [
        'pagina' => 'page', 'tiempo' => 'time', 'seccion' => 'section', 'diapositiva' => 'slide',
        'hoja' => 'sheet', 'imagen' => 'image',
    ];

    public const ANCHOR_KEYS = [
        'tipo' => 'type', 'fisica' => 'physical', 'impresa' => 'printed', 'romana' => 'roman', 'origen' => 'source',
        'confianza' => 'confidence', 'hablante' => 'speaker', 'ruta' => 'path', 'parrafo' => 'paragraph',
        'hoja' => 'sheet', 'filaDesde' => 'row_from', 'filaHasta' => 'row_to', 'consultada' => 'accessed',
    ];

    public const ANCHOR_SOURCES = ['leido' => 'read', 'deducido' => 'inferred', 'ninguno' => 'none'];

    /**
     * SELECT list that exposes a legacy table under 5.0 column names. Columns the
     * legacy file lacks come out as NULL (or their 5.0 default).
     */
    public static function selectList(string $table, array $legacyColumns): string
    {
        [, $cols] = self::TABLES[$table];
        $parts = [];
        foreach ($cols as $new => $old) {
            if ($old !== null && in_array($old, $legacyColumns, true)) {
                $expr = Container::quoteIdent($old);
            } else {
                $expr = self::DEFAULTS["{$table}.{$new}"] ?? 'NULL';
            }
            $parts[] = "{$expr} AS " . Container::quoteIdent($new);
        }
        return implode(', ', $parts);
    }

    public static function legacyColumn(string $table, string $column): ?string
    {
        return self::TABLES[$table][1][$column] ?? null;
    }

    public static function kind(?string $tipo): ?string
    {
        return $tipo === null ? null : (self::KINDS[$tipo] ?? $tipo);
    }

    public static function target(string $objetivo): string
    {
        return self::TARGETS[$objetivo] ?? $objetivo;
    }

    /** 5.0 target name => legacy value. */
    public static function legacyTarget(string $target): string
    {
        $flip = array_flip(self::TARGETS);
        return $flip[$target] ?? $target;
    }

    /** Maps a decoded legacy anchor to the 5.0 anchor. */
    public static function anchor(mixed $a): mixed
    {
        if (!is_array($a) || array_is_list($a)) {
            return $a;
        }
        $out = [];
        foreach ($a as $k => $v) {
            $key = self::ANCHOR_KEYS[$k] ?? $k;
            if ($key === 'type' && is_string($v)) {
                $v = self::ANCHOR_TYPES[$v] ?? $v;
            } elseif ($key === 'source' && is_string($v)) {
                $v = self::ANCHOR_SOURCES[$v] ?? $v;
            }
            $out[$key] = $v;
        }
        return $out;
    }

    /** Field names of MetadatosDocumento that map one-to-one onto CSL variables. */
    private const META_SIMPLE = [
        'editorial' => 'publisher', 'lugar' => 'publisher-place',
        'coleccion' => 'collection-title', 'volumen' => 'volume',
        'numero' => 'issue', 'paginas' => 'page', 'edicion' => 'edition', 'doi' => 'DOI', 'isbn' => 'ISBN',
        'url' => 'URL', 'idioma' => 'language', 'resumen' => 'abstract',
    ];

    private const META_PEOPLE = [
        'autores' => 'author', 'editores' => 'editor', 'traductores' => 'translator', 'entrevistadores' => 'interviewer',
    ];

    /** Default CSL type by legacy kind (tipo) when tipoCSL is absent. */
    private const TYPE_BY_KIND = [
        'audio' => 'speech', 'video' => 'motion_picture', 'web' => 'webpage', 'presentacion' => 'speech',
        'hoja' => 'dataset', 'imagen' => 'graphic', 'fotos' => 'graphic',
    ];

    /** spdf_meta keys renamed in the 5.0 view. */
    public const META_KEYS = ['creado' => 'created', 'generador' => 'generator'];

    public static function metaKey(string $clave): string
    {
        return self::META_KEYS[$clave] ?? $clave;
    }

    /**
     * Legacy reference (documentos.original, unit imagen/miniatura, figure imagen):
     * '' -> null (figures keep ''), a blob key -> 'blob:<key>', anything else verbatim.
     *
     * @param array<string,true> $blobKeys
     */
    public static function reference(?string $value, array $blobKeys, bool $keepEmpty = false): ?string
    {
        if ($value === null) {
            return null;
        }
        if ($value === '') {
            return $keepEmpty ? '' : null;
        }
        if (isset($blobKeys[$value])) {
            return 'blob:' . $value;
        }
        return $value;
    }

    /** Legacy modality names. */
    public const MODALITIES = ['texto' => 'text', 'imagen' => 'image'];

    /** Legacy MetadatosDocumento field => CSL variable (spdf.* = extension member). */
    public const FIELDS = [
        'titulo' => 'title', 'subtitulo' => 'spdf.subtitle', 'tituloOriginal' => 'original-title', 'autores' => 'author',
        'editores' => 'editor', 'traductores' => 'translator', 'entrevistadores' => 'interviewer', 'anio' => 'issued',
        'anioOriginal' => 'original-date', 'editorial' => 'publisher', 'lugar' => 'publisher-place',
        'revista' => 'container-title', 'contenedor' => 'container-title', 'coleccion' => 'collection-title',
        'volumen' => 'volume', 'numero' => 'issue', 'paginas' => 'page', 'edicion' => 'edition', 'doi' => 'DOI',
        'isbn' => 'ISBN', 'url' => 'URL', 'idioma' => 'language', 'tipoCSL' => 'type', 'resumen' => 'abstract',
        'idiomaOriginal' => 'spdf.original_language', 'fecha' => 'issued', 'sinFecha' => 'spdf.undated',
    ];

    /** Legacy provenance sources (fuente) => 5.0 names. */
    public const PROVENANCE_SOURCES = [
        'lectura' => 'reading', 'usuario' => 'user', 'colofon' => 'colophon', 'impresores' => 'printers',
    ];

    /** @param mixed $list decoded JSON modalities */
    public static function modalities(mixed $list): mixed
    {
        if (!is_array($list) || !array_is_list($list)) {
            return $list;
        }
        return array_map(fn ($x) => is_string($x) ? (self::MODALITIES[$x] ?? $x) : $x, $list);
    }

    /** Present = not null, not '' and not []. */
    private static function has(array $m, string $k): bool
    {
        if (!array_key_exists($k, $m)) {
            return false;
        }
        $v = $m[$k];
        return $v !== null && $v !== '' && $v !== [];
    }

    private static function truthy(mixed $v): bool
    {
        return !($v === null || $v === false || $v === '' || $v === 0 || $v === 0.0 || $v === []);
    }

    /** @return list<array<string,string>> */
    private static function people(mixed $list): array
    {
        $out = [];
        foreach (is_array($list) && array_is_list($list) ? $list : [] as $p) {
            if (!is_array($p)) {
                continue;
            }
            $n = [];
            if (self::truthy($p['apellidos'] ?? null)) {
                $n['family'] = $p['apellidos'];
            }
            if (self::truthy($p['nombre'] ?? null)) {
                $n['given'] = $p['nombre'];
            }
            if ($n !== []) {
                $out[] = $n;
            }
        }
        return $out;
    }

    /** CSL type when tipoCSL is absent: revista -> article-journal, then by kind, else book. */
    public static function defaultType(?string $tipo, array $m): string
    {
        if (self::truthy($m['tipoCSL'] ?? null)) {
            return (string) $m['tipoCSL'];
        }
        if (self::truthy($m['revista'] ?? null)) {
            return 'article-journal';
        }
        return self::TYPE_BY_KIND[$tipo ?? ''] ?? 'book';
    }

    /**
     * Maps a decoded legacy MetadatosDocumento to a CSL-JSON item with the `spdf`
     * extension object (contract §7). `$tipo` is the legacy kind (documentos.tipo).
     */
    public static function metadata(mixed $m, ?string $tipo = null): mixed
    {
        if (!is_array($m) || (array_is_list($m) && $m !== [])) {
            return $m;
        }
        $item = ['type' => self::defaultType($tipo, $m)];
        $ext = [];
        $title = self::truthy($m['titulo'] ?? null) ? (string) $m['titulo'] : '';
        if (self::has($m, 'subtitulo')) {
            $item['title'] = "{$title}: {$m['subtitulo']}";
            $item['title-short'] = $title;
            $ext['subtitle'] = $m['subtitulo'];
        } else {
            $item['title'] = $title;
        }
        if (self::has($m, 'tituloOriginal')) {
            $item['original-title'] = $m['tituloOriginal'];
        }
        $orcid = [];
        foreach (self::META_PEOPLE as $src => $dst) {
            $names = self::people($m[$src] ?? null);
            if ($names !== []) {
                $item[$dst] = $names;
            }
            foreach (is_array($m[$src] ?? null) ? $m[$src] : [] as $a) {
                if (is_array($a) && self::truthy($a['orcid'] ?? null)) {
                    $key = (string) ($a['apellidos'] ?? '') . (self::truthy($a['nombre'] ?? null) ? ', ' . $a['nombre'] : '');
                    $orcid[$key] = $a['orcid'];
                }
            }
        }
        $fecha = null;
        if (self::has($m, 'fecha') && is_string($m['fecha'])
            && preg_match('/^(-?\d{1,4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?/', trim($m['fecha']), $mm)) {
            $fecha = [(int) $mm[1]];
            if (isset($mm[2]) && $mm[2] !== '') {
                $fecha[] = (int) $mm[2];
            }
            if (isset($mm[3]) && $mm[3] !== '') {
                $fecha[] = (int) $mm[3];
            }
        }
        if ($fecha !== null && (!self::has($m, 'anio') || $fecha[0] == $m['anio'])) {
            $item['issued'] = ['date-parts' => [$fecha]];
        } elseif (self::has($m, 'anio')) {
            $item['issued'] = ['date-parts' => [[$m['anio']]]];
        }
        if (self::has($m, 'anioOriginal')) {
            $item['original-date'] = ['date-parts' => [[$m['anioOriginal']]]];
        }
        foreach (self::META_SIMPLE as $src => $dst) {
            if (self::has($m, $src)) {
                $item[$dst] = $m[$src];
            }
        }
        if (self::has($m, 'revista')) {
            $item['container-title'] = $m['revista'];
        } elseif (self::has($m, 'contenedor')) {
            $item['container-title'] = $m['contenedor'];
        }
        if (self::has($m, 'idiomaOriginal')) {
            $ext['original_language'] = $m['idiomaOriginal'];
        }
        if (self::has($m, 'sinFecha') && is_array($m['sinFecha'])) {
            $sf = $m['sinFecha'];
            $u = [];
            if (($sf['desde'] ?? null) !== null) {
                $u['from'] = $sf['desde'];
            }
            if (($sf['hasta'] ?? null) !== null) {
                $u['to'] = $sf['hasta'];
            }
            if (self::truthy($sf['fundamento'] ?? null)) {
                $u['basis'] = $sf['fundamento'];
            }
            $ext['undated'] = $u === [] ? new \stdClass() : $u;
        }
        if (self::has($m, 'procedencia') && is_array($m['procedencia'])) {
            $prov = [];
            foreach ($m['procedencia'] as $campo => $v) {
                $key = self::FIELDS[(string) $campo] ?? (string) $campo;
                if (str_starts_with($key, 'spdf.')) {
                    $key = substr($key, 5);
                }
                $v = is_array($v) ? $v : [];
                $fuente = $v['fuente'] ?? null;
                $prov[$key] = [
                    'source' => is_string($fuente) ? (self::PROVENANCE_SOURCES[$fuente] ?? $fuente) : $fuente,
                    'confidence' => $v['confianza'] ?? null,
                ];
            }
            $ext['provenance'] = $prov === [] ? new \stdClass() : $prov;
        }
        if ($orcid !== []) {
            $ext['orcid'] = $orcid;
        }
        if ($ext !== []) {
            $item['spdf'] = $ext;
        }
        return $item;
    }
}
