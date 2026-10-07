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
        'tituloOriginal' => 'original-title', 'editorial' => 'publisher', 'lugar' => 'publisher-place',
        'revista' => 'container-title', 'coleccion' => 'collection-title', 'volumen' => 'volume',
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

    private static function present(mixed $v): bool
    {
        return $v !== null && $v !== '' && $v !== [] && !($v instanceof \stdClass && get_object_vars($v) === []);
    }

    /** @return list<array<string,string>> */
    private static function people(mixed $list, array &$orcid): array
    {
        if (!is_array($list) || !array_is_list($list)) {
            return [];
        }
        $out = [];
        foreach ($list as $p) {
            if (!is_array($p)) {
                continue;
            }
            $person = [];
            if (isset($p['apellidos']) && is_string($p['apellidos']) && $p['apellidos'] !== '') {
                $person['family'] = $p['apellidos'];
            }
            if (isset($p['nombre']) && is_string($p['nombre']) && $p['nombre'] !== '') {
                $person['given'] = $p['nombre'];
            }
            if ($person === []) {
                continue;
            }
            if (isset($p['orcid']) && is_string($p['orcid']) && $p['orcid'] !== '') {
                $label = isset($person['family'], $person['given'])
                    ? $person['family'] . ', ' . $person['given']
                    : ($person['family'] ?? $person['given']);
                $orcid[$label] = $p['orcid'];
            }
            $out[] = $person;
        }
        return $out;
    }

    /**
     * Maps a decoded legacy MetadatosDocumento to a CSL-JSON item with the `spdf`
     * extension object (contract §7). `$tipo` is the legacy kind (documentos.tipo).
     */
    public static function metadata(mixed $m, ?string $tipo = null): mixed
    {
        if (!is_array($m) || array_is_list($m)) {
            return $m;
        }
        $csl = [];
        $ext = [];
        $title = isset($m['titulo']) && is_string($m['titulo']) && $m['titulo'] !== '' ? $m['titulo'] : null;
        $subtitle = isset($m['subtitulo']) && is_string($m['subtitulo']) && $m['subtitulo'] !== '' ? $m['subtitulo'] : null;
        if ($title !== null) {
            $csl['title'] = $subtitle !== null ? "{$title}: {$subtitle}" : $title;
            if ($subtitle !== null) {
                $csl['title-short'] = $title;
            }
        } elseif ($subtitle !== null) {
            $csl['title'] = $subtitle;
        }
        if ($subtitle !== null) {
            $ext['subtitle'] = $subtitle;
        }
        $orcid = [];
        foreach (self::META_PEOPLE as $old => $new) {
            $people = self::people($m[$old] ?? null, $orcid);
            if ($people !== []) {
                $csl[$new] = $people;
            }
        }
        $anio = isset($m['anio']) && is_numeric($m['anio']) ? (int) $m['anio'] : null;
        $fecha = null;
        if (isset($m['fecha']) && is_string($m['fecha'])
            && preg_match('/^(-?\d{1,4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?/', $m['fecha'], $mm)) {
            $fecha = [(int) $mm[1]];
            if (isset($mm[2]) && $mm[2] !== '') {
                $fecha[] = (int) $mm[2];
                if (isset($mm[3]) && $mm[3] !== '') {
                    $fecha[] = (int) $mm[3];
                }
            }
        }
        if ($fecha !== null && ($anio === null || $fecha[0] === $anio)) {
            $csl['issued'] = ['date-parts' => [$fecha]];
        } elseif ($anio !== null) {
            $csl['issued'] = ['date-parts' => [[$anio]]];
        }
        if (isset($m['anioOriginal']) && is_numeric($m['anioOriginal'])) {
            $csl['original-date'] = ['date-parts' => [[(int) $m['anioOriginal']]]];
        }
        foreach (self::META_SIMPLE as $old => $new) {
            if (isset($m[$old]) && self::present($m[$old])) {
                $csl[$new] = $m[$old];
            }
        }
        if (!isset($csl['container-title']) && isset($m['contenedor']) && self::present($m['contenedor'])) {
            $csl['container-title'] = $m['contenedor'];
        }
        if (isset($m['tipoCSL']) && is_string($m['tipoCSL']) && $m['tipoCSL'] !== '') {
            $csl['type'] = $m['tipoCSL'];
        } elseif ($tipo !== null && isset(self::TYPE_BY_KIND[$tipo])) {
            $csl['type'] = self::TYPE_BY_KIND[$tipo];
        } elseif (isset($m['revista']) && self::present($m['revista'])) {
            $csl['type'] = 'article-journal';
        } else {
            $csl['type'] = 'book';
        }
        if (isset($m['idiomaOriginal']) && self::present($m['idiomaOriginal'])) {
            $ext['original_language'] = $m['idiomaOriginal'];
        }
        if (isset($m['sinFecha']) && is_array($m['sinFecha'])) {
            $u = [];
            foreach (['desde' => 'from', 'hasta' => 'to', 'fundamento' => 'basis'] as $old => $new) {
                if (isset($m['sinFecha'][$old]) && self::present($m['sinFecha'][$old])) {
                    $u[$new] = $m['sinFecha'][$old];
                }
            }
            if ($u !== []) {
                $ext['undated'] = $u;
            }
        }
        if (isset($m['procedencia']) && is_array($m['procedencia']) && !array_is_list($m['procedencia'])) {
            $prov = [];
            foreach ($m['procedencia'] as $field => $p) {
                if (!is_array($p)) {
                    continue;
                }
                $entry = [];
                foreach ($p as $k => $v) {
                    $entry[match ($k) { 'fuente' => 'source', 'confianza' => 'confidence', default => $k }] = $v;
                }
                $prov[(string) $field] = $entry === [] ? new \stdClass() : $entry;
            }
            if ($prov !== []) {
                $ext['provenance'] = $prov;
            }
        }
        if ($orcid !== []) {
            $ext['orcid'] = $orcid;
        }
        if ($ext !== []) {
            $csl['spdf'] = $ext;
        }
        return $csl;
    }
}
