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
        $es = strtolower(substr($locale, 0, 2)) === 'es';
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
        $colon = strpos($title, ':');
        return trim($colon === false ? $title : substr($title, 0, $colon));
    }

    /** Spanish "y" becomes "e" before the sound /i/: i, í, hi, hí not followed by a vowel. */
    private static function startsWithI(string $s): bool
    {
        $l = mb_strtolower(Text::nfc($s), 'UTF-8');
        if (str_starts_with($l, 'h')) {
            $l = substr($l, 1);
        }
        if (!(str_starts_with($l, 'i') || str_starts_with($l, 'í'))) {
            return false;
        }
        $next = mb_substr($l, 1, 1, 'UTF-8');
        return !preg_match('/^[aeiouáéíóúü]$/u', $next);
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
        if ($y < 0) {
            return abs($y) . ($es ? ' a. C.' : ' BC');
        }
        return (string) $y;
    }

    public static function locator(array $a, ?array $end, bool $es): ?string
    {
        $type = $a['type'] ?? null;
        switch ($type) {
            case 'page':
                return self::pageLocator($a, ($end['type'] ?? null) === 'page' ? $end : null, $es);
            case 'section':
            case 'web':
                if (self::printed($a) !== null) {
                    $e = $end !== null && self::printed($end) !== null ? $end : null;
                    return self::pageLocator($a, $e, $es);
                }
                $path = isset($a['path']) && is_array($a['path']) ? array_values($a['path']) : [];
                $para = isset($a['paragraph']) && is_numeric($a['paragraph']) ? (int) $a['paragraph'] : null;
                $paraText = $para === null ? null : ($es ? 'párr. ' : 'para. ') . $para;
                if ($path === []) {
                    return $paraText;
                }
                $s = '§ ' . $path[count($path) - 1];
                return $paraText === null ? $s : "{$s}, {$paraText}";
            case 'time':
                $t0 = isset($a['t0']) && is_numeric($a['t0']) ? (float) $a['t0'] : 0.0;
                $s = self::clock($t0);
                if (($end['type'] ?? null) === 'time' && isset($end['t1']) && is_numeric($end['t1'])) {
                    $s .= '-' . self::clock((float) $end['t1']);
                }
                return $s;
            case 'slide':
                return ($es ? 'diap. ' : 'slide ') . ($a['n'] ?? '');
            case 'sheet':
                $from = $a['row_from'] ?? null;
                $to = $a['row_to'] ?? $from;
                $s = (string) ($a['sheet'] ?? '');
                if ($from === null) {
                    return $s;
                }
                return $s . ', ' . ($es ? 'filas ' : 'rows ') . $from . '-' . $to;
            case 'verse':
                $from = $a['line_from'] ?? null;
                $to = $a['line_to'] ?? null;
                if ($to === null || $to == $from) {
                    return 'v. ' . $from;
                }
                return "vv. {$from}-{$to}";
            case 'canonical':
                return isset($a['ref']) ? (string) $a['ref'] : null;
            case 'image':
                return null;
        }
        return null;
    }

    private static function printed(?array $a): ?string
    {
        if ($a === null || !isset($a['printed']) || $a['printed'] === '' || !is_scalar($a['printed'])) {
            return null;
        }
        return (string) $a['printed'];
    }

    private static function folio(array $a): string
    {
        $p = self::printed($a) ?? '';
        return ($a['source'] ?? null) === 'inferred' ? "[{$p}]" : $p;
    }

    private static function pageLocator(array $a, ?array $end, bool $es): string
    {
        $printed = self::printed($a);
        if ($printed === null) {
            return $es ? 's. p.' : 'n. pag.';
        }
        [$one, $many] = match ($a['foliation'] ?? 'page') {
            'leaf' => ['fol.', 'fols.'],
            'column' => ['col.', 'cols.'],
            default => ['p.', 'pp.'],
        };
        $endPrinted = self::printed($end);
        if ($end !== null && $endPrinted !== null && $endPrinted !== $printed) {
            return "{$many} " . self::folio($a) . '-' . self::folio($end);
        }
        return "{$one} " . self::folio($a);
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
