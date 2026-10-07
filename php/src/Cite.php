<?php

declare(strict_types=1);

namespace Spdf;

/**
 * Short author-date citation `(Names, Year, locator)` (contract §10).
 * Locales: `es` and `en`; anything else falls back to `en`.
 */
final class Cite
{
    public static function short(array $metadata, ?array $anchor, ?array $anchorEnd = null, string $locale = 'es'): string
    {
        $es = strtolower(explode('-', str_replace('_', '-', $locale))[0]) === 'es';
        $parts = [self::names($metadata, $es), self::year($metadata, $es)];
        $loc = $anchor === null ? null : self::locator($anchor, $anchorEnd, $es);
        if ($loc !== null && $loc !== '') {
            $parts[] = $loc;
        }
        return '(' . implode(', ', $parts) . ')';
    }

    /** Display name of a CSL name object. */
    public static function name(mixed $p): ?string
    {
        if (!is_array($p)) {
            return null;
        }
        if (isset($p['literal']) && is_string($p['literal']) && $p['literal'] !== '') {
            return $p['literal'];
        }
        if (isset($p['family']) && is_string($p['family']) && $p['family'] !== '') {
            $particle = $p['non-dropping-particle'] ?? null;
            return (is_string($particle) && $particle !== '' ? $particle . ' ' : '') . $p['family'];
        }
        if (isset($p['given']) && is_string($p['given']) && $p['given'] !== '') {
            return $p['given'];
        }
        return null;
    }

    public static function names(array $m, bool $es): string
    {
        $names = [];
        foreach ((isset($m['author']) && is_array($m['author']) ? $m['author'] : []) as $p) {
            $n = self::name($p);
            if ($n !== null) {
                $names[] = $n;
            }
        }
        $count = count($names);
        if ($count === 1) {
            return $names[0];
        }
        if ($count === 2) {
            $and = $es ? (self::startsWithI($names[1]) ? 'e' : 'y') : 'and';
            return "{$names[0]} {$and} {$names[1]}";
        }
        if ($count >= 3) {
            return "{$names[0]} et al.";
        }
        if (isset($m['title-short']) && is_string($m['title-short']) && $m['title-short'] !== '') {
            return $m['title-short'];
        }
        $title = isset($m['title']) && is_string($m['title']) ? $m['title'] : '';
        return trim(explode(':', $title)[0]);
    }

    /** Spanish "y" becomes "e" before the sound /i/: i, í, hi, hí not followed by a vowel. */
    private static function startsWithI(string $s): bool
    {
        $l = mb_strtolower($s, 'UTF-8');
        $two = mb_substr($l, 0, 2, 'UTF-8');
        $one = mb_substr($l, 0, 1, 'UTF-8');
        if ($two === 'hi' || $two === 'hí') {
            $rest = mb_substr($l, 2, null, 'UTF-8');
        } elseif ($one === 'i' || $one === 'í') {
            $rest = mb_substr($l, 1, null, 'UTF-8');
        } else {
            return false;
        }
        return !($rest !== '' && in_array(mb_substr($rest, 0, 1, 'UTF-8'), ['a', 'e', 'i', 'o', 'u', 'á', 'é', 'í', 'ó', 'ú', 'ü'], true));
    }

    public static function year(array $m, bool $es): string
    {
        $y = $m['issued']['date-parts'][0][0] ?? null;
        if (is_string($y) && preg_match('/^-?\d+$/', $y)) {
            $y = (int) $y;
        }
        if (is_float($y)) {
            $y = (int) $y;
        }
        if (!is_int($y)) {
            return $es ? 's. f.' : 'n.d.';
        }
        if ($y <= 0) {
            return (-$y) . ($es ? ' a. C.' : ' BC');
        }
        return (string) $y;
    }

    public static function locator(array $a, ?array $end, bool $es): ?string
    {
        $type = $a['type'] ?? null;
        switch ($type) {
            case 'page':
                [$one, $many] = match ($a['foliation'] ?? 'page') {
                    'leaf' => ['fol.', 'fols.'],
                    'column' => ['col.', 'cols.'],
                    default => ['p.', 'pp.'],
                };
                return self::pageLocator($a, $end, $es, $one, $many);
            case 'time':
                $s = self::clock((float) ($a['t0'] ?? 0));
                if ($end !== null && ($end['type'] ?? null) === 'time') {
                    $s .= '-' . self::clock((float) ($end['t1'] ?? 0));
                }
                return $s;
            case 'section':
            case 'web':
                if (($a['printed'] ?? null) !== null) {
                    return self::pageLocator($a, $end, $es, 'p.', 'pp.');
                }
                $parts = [];
                if (isset($a['path']) && is_array($a['path']) && $a['path'] !== []) {
                    $parts[] = '§ ' . $a['path'][count($a['path']) - 1];
                }
                if (($a['paragraph'] ?? null) !== null) {
                    $parts[] = ($es ? 'párr. ' : 'para. ') . $a['paragraph'];
                }
                return $parts === [] ? null : implode(', ', $parts);
            case 'slide':
                return ($es ? 'diap. ' : 'slide ') . ($a['n'] ?? '');
            case 'sheet':
                $from = $a['row_from'] ?? null;
                $to = $a['row_to'] ?? null;
                if ($from == $to) {
                    return ($a['sheet'] ?? '') . ', ' . ($es ? 'fila ' : 'row ') . $from;
                }
                return ($a['sheet'] ?? '') . ', ' . ($es ? 'filas ' : 'rows ') . $from . '-' . $to;
            case 'verse':
                $from = $a['line_from'] ?? null;
                $to = $a['line_to'] ?? null;
                return $to === null || $to == $from ? "v. {$from}" : "vv. {$from}-{$to}";
            case 'canonical':
                return isset($a['ref']) ? (string) $a['ref'] : null;
        }
        return null;
    }

    private static function label(array $a): ?string
    {
        $p = $a['printed'] ?? null;
        if ($p === null) {
            return null;
        }
        return ($a['source'] ?? null) === 'inferred' ? "[{$p}]" : (string) $p;
    }

    private static function pageLocator(array $a, ?array $end, bool $es, string $one, string $many): string
    {
        $la = self::label($a);
        if ($la === null) {
            return $es ? 's. p.' : 'n. pag.';
        }
        if ($end !== null && ($end['type'] ?? null) === ($a['type'] ?? null)) {
            $lb = self::label($end);
            if ($lb !== null && ($end['printed'] ?? null) !== ($a['printed'] ?? null)) {
                return "{$many} {$la}-{$lb}";
            }
        }
        return "{$one} {$la}";
    }

    /**
     * CSL `label` and `locator` of an anchor (SPEC §19.2), or null when CSL has none.
     *
     * @return array{0:string,1:string}|null
     */
    public static function cslLocator(array $a, ?array $end = null): ?array
    {
        $t = $a['type'] ?? null;
        $folio = fn (array $x) => ($x['printed'] ?? null) === null ? null
            : ((($x['source'] ?? null) === 'inferred') ? '[' . $x['printed'] . ']' : (string) $x['printed']);
        if ($t === 'page' || (in_array($t, ['section', 'web'], true) && ($a['printed'] ?? null) !== null)) {
            $f = $folio($a);
            if ($f === null) {
                return null;
            }
            $label = $t === 'page' ? (['leaf' => 'folio', 'column' => 'column'][$a['foliation'] ?? 'page'] ?? 'page') : 'page';
            if ($end !== null && ($end['type'] ?? null) === $t && ($end['printed'] ?? null) !== null
                && ($end['printed'] ?? null) !== ($a['printed'] ?? null)) {
                return [$label, $f . '-' . $folio($end)];
            }
            return [$label, $f];
        }
        if ($t === 'section' || $t === 'web') {
            if (($a['paragraph'] ?? null) !== null) {
                return ['paragraph', (string) $a['paragraph']];
            }
            if (isset($a['path']) && is_array($a['path']) && $a['path'] !== []) {
                return ['section', (string) $a['path'][count($a['path']) - 1]];
            }
            return null;
        }
        if ($t === 'time') {
            $s = self::clock((float) ($a['t0'] ?? 0));
            if ($end !== null && ($end['type'] ?? null) === 'time') {
                $s .= '-' . self::clock((float) ($end['t1'] ?? 0));
            }
            return ['timestamp', $s];
        }
        if ($t === 'verse') {
            $from = $a['line_from'] ?? null;
            $to = $a['line_to'] ?? null;
            return ['verse', $to === null || $to == $from ? (string) $from : "{$from}-{$to}"];
        }
        if ($t === 'canonical') {
            return ['section', (string) ($a['ref'] ?? '')];
        }
        if ($t === 'sheet') {
            $from = $a['row_from'] ?? null;
            $to = $a['row_to'] ?? null;
            return ['line', $from == $to ? (string) $from : "{$from}-{$to}"];
        }
        return null;
    }

    /** `h:mm:ss` from one hour, else `m:ss`; seconds floored. */
    public static function clock(float $t): string
    {
        $s = (int) floor(max(0.0, $t));
        $h = intdiv($s, 3600);
        $m = intdiv($s % 3600, 60);
        $sec = $s % 60;
        if ($h > 0) {
            return sprintf('%d:%02d:%02d', $h, $m, $sec);
        }
        return sprintf('%d:%02d', $m, $sec);
    }
}
