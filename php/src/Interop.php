<?php

declare(strict_types=1);

namespace Spdf;

/**
 * Exports to library formats (SPEC §19.4): ALTO 4, a minimal TEI P5 and a IIIF
 * Presentation 3 manifest. SPDF stores text per unit, not word boxes, so nothing here
 * carries invented coordinates.
 */
final class Interop
{
    public const ALTO_NS = 'http://www.loc.gov/standards/alto/ns-v4#';
    public const TEI_NS = 'http://www.tei-c.org/ns/1.0';
    public const IIIF_CONTEXT = 'http://iiif.io/api/presentation/3/context.json';
    /** Nominal canvas size when no page image size is known (A-series proportions). */
    public const DEFAULT_SIZE = [1000, 1414];

    private static function x(?string $s): string
    {
        return htmlspecialchars((string) $s, ENT_XML1 | ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    }

    /** Removes light Markdown markers (headings, quotes, bullets, emphasis, code). */
    private static function clean(string $line): string
    {
        $line = preg_replace('/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+(?=\S))/u', '', $line) ?? $line;
        return preg_replace('/(\*\*|__|`)/u', '', $line) ?? $line;
    }

    /** @return list<string> */
    private static function paragraphs(string $text): array
    {
        $parts = preg_split('/\n\s*\n/u', $text) ?: [];
        return array_values(array_filter(array_map('trim', $parts), fn ($p) => $p !== ''));
    }

    /** The folio of a page anchor as TEI `pb/@n` and IIIF labels write it: `[iv]` if inferred. */
    public static function folio(array $a): ?string
    {
        if (($a['printed'] ?? null) === null) {
            return null;
        }
        return ($a['source'] ?? null) === 'inferred' ? '[' . $a['printed'] . ']' : (string) $a['printed'];
    }

    private static function title(Document $doc): string
    {
        return (string) ($doc->title() ?? $doc->document()['id']);
    }

    // ------------------------------------------------------------------ ALTO

    /** ALTO 4 XML: one Page per page unit. Throws if the document has no page units. */
    public static function alto(Document $doc): string
    {
        $pages = array_values(array_filter($doc->units(), fn ($u) => (($u['anchor']['type'] ?? null) === 'page')));
        if ($pages === []) {
            throw new SpdfException('E000', 'ALTO export needs page units; this document has none (try TEI or IIIF).');
        }
        $out = [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<alto xmlns="' . self::ALTO_NS . '" xmlns:xlink="http://www.w3.org/1999/xlink" '
            . 'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" '
            . 'xsi:schemaLocation="' . self::ALTO_NS . ' http://www.loc.gov/standards/alto/v4/alto-4-4.xsd">',
            '<Description>',
            '<MeasurementUnit>pixel</MeasurementUnit>',
            '<sourceImageInformation>',
            '<fileName>' . self::x(self::title($doc)) . '</fileName>',
            '<fileIdentifier>' . self::x($doc->docref()) . '</fileIdentifier>',
            '</sourceImageInformation>',
            '<Processing ID="PROC_SPDF">',
            '<processingStepDescription>Export from SPDF</processingStepDescription>',
            '<processingSoftware><softwareName>spdf-php</softwareName>'
            . '<softwareVersion>' . Conformance\Runner::VERSION . '</softwareVersion></processingSoftware>',
            '</Processing>',
            '</Description>',
            '<Tags><StructureTag ID="TAG_NOTE" LABEL="footnote"/></Tags>',
            '<Layout>',
        ];
        foreach ($pages as $u) {
            $a = $u['anchor'];
            $physical = (int) ($a['physical'] ?? $u['ord']);
            $pid = "P{$physical}";
            $attrs = "ID=\"{$pid}\" PHYSICAL_IMG_NR=\"{$physical}\"";
            // ALTO records printed numbers: an inferred folio was not printed (SPEC §19.4).
            if (($a['printed'] ?? null) !== null && ($a['source'] ?? null) !== 'inferred') {
                $attrs .= ' PRINTED_IMG_NR="' . self::x((string) $a['printed']) . '"';
            }
            if (isset($u['confidence'])) {
                $attrs .= ' PC="' . rtrim(rtrim(sprintf('%.4F', max(0.0, min(1.0, (float) $u['confidence']))), '0'), '.') . '"';
            }
            $out[] = "<Page {$attrs}>";
            if (($u['header'] ?? '') !== '' && $u['header'] !== null) {
                $out[] = "<TopMargin ID=\"{$pid}_TM\">";
                array_push($out, ...self::altoBlocks("{$pid}_TM_B", (string) $u['header']));
                $out[] = '</TopMargin>';
            }
            if (($u['footer'] ?? '') !== '' && $u['footer'] !== null) {
                $out[] = "<BottomMargin ID=\"{$pid}_BM\">";
                array_push($out, ...self::altoBlocks("{$pid}_BM_B", (string) $u['footer']));
                $out[] = '</BottomMargin>';
            }
            $out[] = "<PrintSpace ID=\"{$pid}_PS\">";
            array_push($out, ...self::altoBlocks("{$pid}_B", (string) $u['text']));
            if (is_array($u['notes'] ?? null) && $u['notes'] !== []) {
                array_push($out, ...self::altoBlocks("{$pid}_N", implode("\n\n", array_map('strval', $u['notes'])), ' TAGREFS="TAG_NOTE"'));
            }
            $out[] = '</PrintSpace>';
            $out[] = '</Page>';
        }
        $out[] = '</Layout>';
        $out[] = '</alto>';
        return implode("\n", $out) . "\n";
    }

    /** @return list<string> */
    private static function altoBlocks(string $id, string $text, string $extra = ''): array
    {
        $out = [];
        foreach (self::paragraphs($text) as $bi => $para) {
            $bid = $id . '_' . ($bi + 1);
            $out[] = "<TextBlock ID=\"{$bid}\"{$extra}>";
            $li = 0;
            foreach (explode("\n", $para) as $line) {
                $words = preg_split('/\s+/u', trim(self::clean($line)), -1, PREG_SPLIT_NO_EMPTY) ?: [];
                if ($words === []) {
                    continue;
                }
                $li++;
                $parts = [];
                foreach ($words as $wi => $w) {
                    if ($wi > 0) {
                        $parts[] = '<SP/>';
                    }
                    $parts[] = "<String ID=\"{$bid}_L{$li}_W" . ($wi + 1) . '" CONTENT="' . self::x($w) . '"/>';
                }
                $out[] = "<TextLine ID=\"{$bid}_L{$li}\">" . implode('', $parts) . '</TextLine>';
            }
            $out[] = '</TextBlock>';
        }
        return $out;
    }

    // ------------------------------------------------------------------ TEI

    private static function person(mixed $p): string
    {
        if (!is_array($p)) {
            return '';
        }
        if (($p['literal'] ?? '') !== '') {
            return (string) $p['literal'];
        }
        $family = trim(implode(' ', array_filter([$p['non-dropping-particle'] ?? null, $p['family'] ?? null])));
        $given = (string) ($p['given'] ?? '');
        return $family !== '' && $given !== '' ? "{$family}, {$given}" : ($family !== '' ? $family : $given);
    }

    /** A minimal TEI P5 document: header from the metadata, `pb`/`p`/`lg`/`u`/`note` in the body. */
    public static function tei(Document $doc): string
    {
        $d = $doc->document();
        $m = $doc->metadata();
        $lang = $d['language'] ?? null;
        $out = ['<?xml version="1.0" encoding="UTF-8"?>', '<TEI xmlns="' . self::TEI_NS . '"' . ($lang ? ' xml:lang="' . self::x($lang) . '"' : '') . '>'];
        $out[] = '<teiHeader>';
        $out[] = '<fileDesc>';
        $out[] = '<titleStmt>';
        $out[] = '<title>' . self::x(self::title($doc)) . '</title>';
        foreach (['author' => 'author', 'editor' => 'editor'] as $csl => $tag) {
            foreach (is_array($m[$csl] ?? null) ? $m[$csl] : [] as $p) {
                $name = self::person($p);
                if ($name !== '') {
                    $out[] = "<{$tag}>" . self::x($name) . "</{$tag}>";
                }
            }
        }
        $out[] = '</titleStmt>';
        $out[] = '<publicationStmt>';
        $out[] = '<distributor>Exported from SPDF with spdf-php</distributor>';
        $out[] = '<idno type="SPDF">spdf:' . self::x($doc->docref()) . '</idno>';
        $rights = is_array($d['rights'] ?? null) ? $d['rights'] : [];
        if ($rights !== []) {
            $lic = $rights['license'] ?? null;
            $target = is_string($lic) && str_starts_with($lic, 'http') ? ' target="' . self::x($lic) . '"' : '';
            $text = trim(implode(' ', array_filter([is_string($lic) ? $lic : null, $rights['holder'] ?? null, $rights['note'] ?? null])));
            $out[] = "<availability><licence{$target}>" . self::x($text) . '</licence></availability>';
        }
        $out[] = '</publicationStmt>';
        $out[] = '<sourceDesc>';
        $out[] = '<bibl>';
        $out[] = '<title>' . self::x((string) ($m['title'] ?? self::title($doc))) . '</title>';
        foreach (is_array($m['author'] ?? null) ? $m['author'] : [] as $p) {
            $name = self::person($p);
            if ($name !== '') {
                $out[] = '<author>' . self::x($name) . '</author>';
            }
        }
        foreach (['container-title' => ['title level="m"', 'title'], 'publisher-place' => ['pubPlace', 'pubPlace'],
            'publisher' => ['publisher', 'publisher'], 'edition' => ['edition', 'edition'], 'collection-title' => ['series', 'series']] as $csl => [$open, $close]) {
            if (isset($m[$csl]) && is_scalar($m[$csl]) && (string) $m[$csl] !== '') {
                $out[] = "<{$open}>" . self::x((string) $m[$csl]) . "</{$close}>";
            }
        }
        $parts = $m['issued']['date-parts'][0] ?? null;
        if (is_array($parts) && $parts !== []) {
            $when = implode('-', array_map(fn ($i, $v) => sprintf($i === 0 ? '%04d' : '%02d', (int) $v), array_keys($parts), $parts));
            $out[] = '<date when="' . self::x($when) . '">' . self::x($when) . '</date>';
        }
        foreach (['DOI' => 'DOI', 'ISBN' => 'ISBN', 'URL' => 'URI'] as $csl => $type) {
            if (isset($m[$csl]) && is_scalar($m[$csl]) && (string) $m[$csl] !== '') {
                $out[] = "<idno type=\"{$type}\">" . self::x((string) $m[$csl]) . '</idno>';
            }
        }
        $out[] = '</bibl>';
        $out[] = '</sourceDesc>';
        $out[] = '</fileDesc>';
        if ($lang) {
            $out[] = '<profileDesc><langUsage><language ident="' . self::x($lang) . '"/></langUsage></profileDesc>';
        }
        $out[] = '</teiHeader>';
        $out[] = '<text>';
        $out[] = '<body>';
        foreach ($doc->units() as $u) {
            array_push($out, ...self::teiUnit($u));
        }
        $out[] = '</body>';
        $out[] = '</text>';
        $out[] = '</TEI>';
        return implode("\n", $out) . "\n";
    }

    /** @return list<string> */
    private static function teiUnit(array $u): array
    {
        $a = is_array($u['anchor']) ? $u['anchor'] : [];
        $type = $a['type'] ?? null;
        $out = [];
        if ($type === 'page') {
            $attrs = '';
            $n = self::folio($a);
            if ($n !== null) {
                $attrs .= ' n="' . self::x($n) . '"';
            }
            if (($u['image'] ?? null) !== null && $u['image'] !== '') {
                $attrs .= ' facs="' . self::x((string) $u['image']) . '"';
            }
            $out[] = "<pb{$attrs}/>";
        }
        $text = (string) ($u['text'] ?? '');
        $notes = array_map(fn ($n) => '<note place="foot">' . self::x(self::clean((string) $n)) . '</note>', is_array($u['notes'] ?? null) ? $u['notes'] : []);
        if ($type === 'verse' && isset($a['line_from'])) {
            $out[] = '<lg>';
            $i = 0;
            foreach (explode("\n", $text) as $line) {
                if (trim($line) === '') {
                    continue;
                }
                $out[] = '<l n="' . ((int) $a['line_from'] + $i) . '">' . self::x(trim(self::clean($line))) . '</l>';
                $i++;
            }
            $out[] = '</lg>';
        } elseif ($type === 'time') {
            foreach (self::paragraphs($text) as $para) {
                $who = $a['speaker'] ?? null;
                if (preg_match('/^\*\*([^*]{1,80}):\*\*\s*/u', $para, $mm)) {
                    $who = trim($mm[1]);
                    $para = substr($para, strlen($mm[0]));
                }
                $whoAttr = $who ? ' who="#' . self::x(preg_replace('/[^A-Za-z0-9_.-]+/', '_', (string) $who)) . '"' : '';
                $out[] = "<u{$whoAttr}>" . self::x(self::clean($para)) . '</u>';
            }
        } elseif (in_array($type, ['section', 'web'], true) && is_array($a['path'] ?? null) && $a['path'] !== []) {
            $out[] = '<div>';
            $out[] = '<head>' . self::x((string) $a['path'][count($a['path']) - 1]) . '</head>';
            foreach (self::paragraphs($text) as $para) {
                $out[] = '<p>' . self::x(self::clean($para)) . '</p>';
            }
            array_push($out, ...$notes);
            $out[] = '</div>';
            return $out;
        } else {
            foreach (self::paragraphs($text) as $para) {
                $out[] = '<p>' . self::x(self::clean($para)) . '</p>';
            }
        }
        array_push($out, ...$notes);
        return $out;
    }

    // ------------------------------------------------------------------ IIIF

    /**
     * IIIF Presentation 3 manifest (an array ready for JSON). `$baseUrl` is where the
     * manifest will live; `blob:<key>` images resolve to `{base}/blobs/<key>`.
     */
    public static function iiif(Document $doc, string $baseUrl): array
    {
        $base = rtrim($baseUrl, '/');
        $d = $doc->document();
        $m = $doc->metadata();
        $lang = is_string($d['language'] ?? null) && $d['language'] !== '' ? $d['language'] : 'none';
        $title = self::title($doc);
        $url = fn (?string $ref) => $ref === null || $ref === '' ? null
            : (str_starts_with($ref, 'blob:') ? $base . '/blobs/' . rawurlencode(substr($ref, 5))
                : (preg_match('#^https?://#', $ref) ? $ref : null));
        $manifest = ['@context' => self::IIIF_CONTEXT, 'id' => "{$base}/manifest.json", 'type' => 'Manifest', 'label' => [$lang => [$title]]];
        $md = [];
        foreach (['Author' => $d['authors'] ?? null, 'Date' => $d['year'] ?? null, 'Publisher' => $m['publisher'] ?? null,
            'Place' => $m['publisher-place'] ?? null, 'Language' => $d['language'] ?? null, 'SPDF' => 'spdf:' . $doc->docref()] as $label => $v) {
            if ($v !== null && $v !== '') {
                $md[] = ['label' => ['en' => [$label]], 'value' => ['none' => [(string) $v]]];
            }
        }
        $manifest['metadata'] = $md;
        if (is_string($m['abstract'] ?? null)) {
            $manifest['summary'] = [$lang => [$m['abstract']]];
        }
        $units = $doc->units();
        $figures = [];
        foreach ($doc->figures() as $g) {
            $figures[(string) $g['unit']][] = $g;
        }
        $canvasOf = [];
        $canvases = [];
        $text = fn (array $u, string $aid, string $target) => [
            'id' => $aid, 'type' => 'Annotation', 'motivation' => 'supplementing',
            'body' => ['type' => 'TextualBody', 'value' => (string) $u['text'], 'format' => 'text/markdown', 'language' => $lang],
            'target' => $target,
            'seeAlso' => [['id' => $doc->anchorUri((array) $u['anchor']), 'type' => 'Text', 'format' => 'text/plain']],
        ];
        if (in_array($d['kind'], ['audio', 'video'], true)) {
            $cid = "{$base}/canvas/1";
            $duration = (float) ($d['duration'] ?? 0) ?: max(array_merge([1.0], array_map(fn ($u) => (float) ($u['t1'] ?? 0), $units)));
            $canvas = ['id' => $cid, 'type' => 'Canvas', 'label' => [$lang => [$title]], 'duration' => $duration, 'items' => []];
            $media = $url($d['source_ref'] ?? null);
            if ($media !== null) {
                $canvas['items'] = [['id' => "{$cid}/page/1", 'type' => 'AnnotationPage', 'items' => [[
                    'id' => "{$cid}/page/1/a1", 'type' => 'Annotation', 'motivation' => 'painting',
                    'body' => ['id' => $media, 'type' => $d['kind'] === 'audio' ? 'Sound' : 'Video', 'format' => $d['mime'], 'duration' => $duration],
                    'target' => $cid,
                ]]]];
            }
            $annos = [];
            foreach ($units as $u) {
                $canvasOf[$u['id']] = $cid;
                if (trim((string) $u['text']) === '') {
                    continue;
                }
                $t0 = $u['t0'] ?? ($u['anchor']['t0'] ?? null);
                $t1 = $u['t1'] ?? ($u['anchor']['t1'] ?? $t0);
                $target = $t0 === null ? $cid : "{$cid}#t=" . Json::number((float) $t0) . ',' . Json::number((float) $t1);
                $annos[] = $text($u, "{$cid}/annotations/{$u['ord']}", $target);
            }
            if ($annos !== []) {
                $canvas['annotations'] = [['id' => "{$cid}/annotations", 'type' => 'AnnotationPage', 'items' => $annos]];
            }
            $canvases[] = $canvas;
        } else {
            foreach ($units as $u) {
                $cid = "{$base}/canvas/{$u['ord']}";
                $canvasOf[$u['id']] = $cid;
                $a = is_array($u['anchor']) ? $u['anchor'] : [];
                [$w, $h] = self::DEFAULT_SIZE;
                $canvas = ['id' => $cid, 'type' => 'Canvas'];
                $label = ($a['type'] ?? null) === 'page' ? self::folio($a) : (Cite::locator($a, null, $lang === 'es') ?? (string) $u['ord']);
                if ($label !== null) {
                    $canvas['label'] = ['none' => [$label]];
                }
                $canvas['width'] = $w;
                $canvas['height'] = $h;
                $page = [];
                $img = $url($u['image'] ?? null);
                if ($img !== null) {
                    $page[] = ['id' => "{$cid}/page/1/a1", 'type' => 'Annotation', 'motivation' => 'painting',
                        'body' => ['id' => $img, 'type' => 'Image', 'width' => $w, 'height' => $h], 'target' => $cid];
                }
                $canvas['items'] = [['id' => "{$cid}/page/1", 'type' => 'AnnotationPage', 'items' => $page]];
                $annos = [];
                if (trim((string) $u['text']) !== '') {
                    $annos[] = $text($u, "{$cid}/annotations/text", $cid);
                }
                foreach ($figures[(string) $u['id']] ?? [] as $i => $g) {
                    $r = $g['anchor']['region'] ?? null;
                    $target = is_array($r) ? "{$cid}#xywh=percent:" . implode(',', array_map(
                        fn ($k) => Json::number((float) sprintf('%.4F', ((float) ($r[$k] ?? 0)) * 100)),
                        ['x', 'y', 'w', 'h'],
                    )) : $cid;
                    $desc = trim(implode(' ', array_filter([$g['caption'] ?? null, $g['description'] ?? null])));
                    if ($desc !== '') {
                        $annos[] = ['id' => "{$cid}/annotations/figure/" . ($i + 1), 'type' => 'Annotation', 'motivation' => 'describing',
                            'body' => ['type' => 'TextualBody', 'value' => $desc, 'format' => 'text/plain', 'language' => $lang], 'target' => $target];
                    }
                }
                if ($annos !== []) {
                    $canvas['annotations'] = [['id' => "{$cid}/annotations", 'type' => 'AnnotationPage', 'items' => $annos]];
                }
                $canvases[] = $canvas;
            }
        }
        $manifest['items'] = $canvases;
        $ranges = self::ranges($doc, $base, $canvasOf, $units, $lang);
        if ($ranges !== []) {
            $manifest['structures'] = $ranges;
        }
        return $manifest;
    }

    /** Sections as nested IIIF ranges. @return list<array> */
    private static function ranges(Document $doc, string $base, array $canvasOf, array $units, string $lang): array
    {
        $sections = $doc->sections();
        if ($sections === []) {
            return [];
        }
        $order = [];
        foreach ($units as $u) {
            $order[$u['id']] = (int) $u['ord'];
        }
        $ids = array_flip(array_map(fn ($s) => $s['id'], $sections));
        $children = [];
        foreach ($sections as $s) {
            $parent = isset($s['parent'], $ids[$s['parent']]) ? $s['parent'] : '';
            $children[$parent][] = $s;
        }
        $sort = function (array $list) use ($order): array {
            usort($list, fn ($a, $b) => [($order[$a['unit_from']] ?? 0), $a['id']] <=> [($order[$b['unit_from']] ?? 0), $b['id']]);
            return $list;
        };
        $build = function (array $s) use (&$build, $children, $sort, $order, $units, $canvasOf, $base, $lang): array {
            $items = [];
            foreach ($sort($children[$s['id']] ?? []) as $c) {
                $items[] = $build($c);
            }
            $start = $order[$s['unit_from']] ?? null;
            $end = $s['unit_to'] !== null ? ($order[$s['unit_to']] ?? $start) : $start;
            if ($items === [] && $start !== null) {
                $seen = [];
                foreach ($units as $u) {
                    if ($u['ord'] >= $start && $u['ord'] <= ($end ?? $start) && isset($canvasOf[$u['id']]) && !isset($seen[$canvasOf[$u['id']]])) {
                        $seen[$canvasOf[$u['id']]] = true;
                        $items[] = ['id' => $canvasOf[$u['id']], 'type' => 'Canvas'];
                    }
                }
            }
            return ['id' => "{$base}/range/" . rawurlencode((string) $s['id']), 'type' => 'Range', 'label' => [$lang => [(string) $s['title']]], 'items' => $items];
        };
        return array_map($build, $sort($children[''] ?? []));
    }
}
