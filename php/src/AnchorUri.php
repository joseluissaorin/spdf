<?php

declare(strict_types=1);

namespace Spdf;

/**
 * Anchor URIs: `spdf:<docref>#<params>` (contract §3).
 *
 * A *locator* is the parsed form of the parameters:
 * `p`, `pe` (int) · `f`, `fe`, `sh` (string) · `t` ([t0, t1]) · `s` (string[]) ·
 * `para`, `sl` (int) · `rows` ([a, b]) · `v` ([a] or [a, b]) · `ref` ({scheme, ref}) ·
 * `char` ([a, b]) · `xywh` ([x, y, w, h] as fractions 0-1).
 * `format(parse(uri))` reproduces the canonical URI byte for byte.
 */
final class AnchorUri
{
    /** Canonical parameter order. */
    public const ORDER = ['p', 'pe', 'f', 'fe', 't', 's', 'para', 'sl', 'sh', 'rows', 'v', 'ref', 'char', 'xywh'];

    /** URI of an anchor (with optional end anchor) of the document `$docref`. */
    public static function fromAnchor(string $docref, array $anchor, ?array $anchorEnd = null): string
    {
        return self::format($docref, self::locator($anchor, $anchorEnd));
    }

    /** The locator that describes an anchor (and optional end anchor). */
    public static function locator(array $a, ?array $end = null): array
    {
        $l = [];
        $type = $a['type'] ?? null;
        $printed = self::str($a['printed'] ?? null);
        switch ($type) {
            case 'page':
                if (isset($a['physical']) && is_numeric($a['physical'])) {
                    $l['p'] = (int) $a['physical'];
                    if (($end['type'] ?? null) === 'page' && isset($end['physical']) && (int) $end['physical'] !== $l['p']) {
                        $l['pe'] = (int) $end['physical'];
                    }
                }
                break;
            case 'time':
                if (isset($a['t0']) && is_numeric($a['t0'])) {
                    $t1 = (($end['type'] ?? null) === 'time' && isset($end['t1'])) ? $end['t1'] : ($a['t1'] ?? null);
                    $l['t'] = $t1 !== null && is_numeric($t1) ? [$a['t0'] + 0, $t1 + 0] : [$a['t0'] + 0];
                }
                break;
            case 'section':
            case 'web':
                if (isset($a['path']) && is_array($a['path']) && $a['path'] !== []) {
                    $l['s'] = array_map('strval', array_values($a['path']));
                }
                if (isset($a['paragraph']) && is_numeric($a['paragraph'])) {
                    $l['para'] = (int) $a['paragraph'];
                }
                break;
            case 'slide':
                if (isset($a['n']) && is_numeric($a['n'])) {
                    $l['sl'] = (int) $a['n'];
                }
                break;
            case 'sheet':
                if (isset($a['sheet'])) {
                    $l['sh'] = (string) $a['sheet'];
                }
                if (isset($a['row_from']) && is_numeric($a['row_from'])) {
                    $l['rows'] = [(int) $a['row_from'], (int) ($a['row_to'] ?? $a['row_from'])];
                }
                break;
            case 'verse':
                if (isset($a['line_from']) && is_numeric($a['line_from'])) {
                    $from = (int) $a['line_from'];
                    $to = isset($a['line_to']) && is_numeric($a['line_to']) ? (int) $a['line_to'] : null;
                    $l['v'] = $to === null || $to === $from ? [$from] : [$from, $to];
                }
                break;
            case 'canonical':
                if (isset($a['scheme'], $a['ref'])) {
                    $l['ref'] = ['scheme' => (string) $a['scheme'], 'ref' => (string) $a['ref']];
                }
                break;
        }
        if ($printed !== null && in_array($type, ['page', 'section', 'verse'], true)) {
            $l['f'] = $printed;
        }
        $endPrinted = self::str($end['printed'] ?? null);
        if ($end !== null && $endPrinted !== null && $endPrinted !== $printed) {
            $l['fe'] = $endPrinted;
        }
        if (isset($a['chars']) && is_array($a['chars']) && count($a['chars']) === 2) {
            $l['char'] = [(int) $a['chars'][0], (int) $a['chars'][1]];
        }
        if (isset($a['region']) && is_array($a['region'])) {
            $r = $a['region'];
            $l['xywh'] = [$r['x'] ?? 0, $r['y'] ?? 0, $r['w'] ?? 0, $r['h'] ?? 0];
        }
        return $l;
    }

    /** Formats a locator as the canonical URI. */
    public static function format(string $docref, array $locator): string
    {
        $parts = [];
        foreach (self::ORDER as $k) {
            if (!array_key_exists($k, $locator) || $locator[$k] === null) {
                continue;
            }
            $v = $locator[$k];
            $parts[] = $k . '=' . match ($k) {
                'p', 'pe', 'para', 'sl' => (string) (int) $v,
                'f', 'fe', 'sh' => rawurlencode((string) $v),
                't' => implode(',', array_map(fn ($x) => Json::number((float) $x), (array) $v)),
                's' => implode('/', array_map(fn ($x) => rawurlencode((string) $x), (array) $v)),
                'rows', 'v' => implode('-', array_map(fn ($x) => (string) (int) $x, (array) $v)),
                'ref' => rawurlencode((string) ($v['scheme'] ?? '')) . ':' . rawurlencode((string) ($v['ref'] ?? '')),
                'char' => implode(',', array_map(fn ($x) => (string) (int) $x, (array) $v)),
                'xywh' => 'percent:' . implode(',', array_map(
                    fn ($x) => Json::ecma((float) sprintf('%.4F', ((float) $x) * 100)),
                    (array) $v,
                )),
            };
        }
        $uri = 'spdf:' . rawurlencode($docref);
        return $parts === [] ? $uri : $uri . '#' . implode('&', $parts);
    }

    /**
     * Parses an anchor URI (leniently).
     *
     * @return array{docref:string, locator:array}
     */
    public static function parse(string $uri): array
    {
        if (!str_starts_with($uri, 'spdf:')) {
            throw new SpdfException('E040', "Not a SPDF anchor URI: {$uri}");
        }
        $rest = substr($uri, 5);
        $hash = strpos($rest, '#');
        $docref = rawurldecode($hash === false ? $rest : substr($rest, 0, $hash));
        $frag = $hash === false ? '' : substr($rest, $hash + 1);
        if ($docref === '') {
            throw new SpdfException('E040', "Anchor URI without a document reference: {$uri}");
        }
        $l = [];
        foreach ($frag === '' ? [] : explode('&', $frag) as $pair) {
            $eq = strpos($pair, '=');
            if ($eq === false) {
                continue;
            }
            $k = rawurldecode(substr($pair, 0, $eq));
            $v = substr($pair, $eq + 1);
            switch ($k) {
                case 'p':
                case 'pe':
                case 'para':
                case 'sl':
                    if (preg_match('/^-?\d+$/', rawurldecode($v))) {
                        $l[$k] = (int) rawurldecode($v);
                    }
                    break;
                case 'f':
                case 'fe':
                case 'sh':
                    $l[$k] = rawurldecode($v);
                    break;
                case 't':
                    $l['t'] = array_map(fn ($x) => self::number(rawurldecode($x)), explode(',', $v));
                    break;
                case 's':
                    $l['s'] = array_map('rawurldecode', explode('/', $v));
                    break;
                case 'rows':
                case 'v':
                    $l[$k] = array_map(fn ($x) => (int) rawurldecode($x), explode('-', rawurldecode($v)));
                    break;
                case 'ref':
                    $colon = strpos($v, ':');
                    if ($colon === false) {
                        $colon = strpos($v, '%3A');
                        $l['ref'] = $colon === false
                            ? ['scheme' => '', 'ref' => rawurldecode($v)]
                            : ['scheme' => rawurldecode(substr($v, 0, $colon)), 'ref' => rawurldecode(substr($v, $colon + 3))];
                    } else {
                        $l['ref'] = ['scheme' => rawurldecode(substr($v, 0, $colon)), 'ref' => rawurldecode(substr($v, $colon + 1))];
                    }
                    break;
                case 'char':
                    $l['char'] = array_map(fn ($x) => (int) $x, explode(',', rawurldecode($v)));
                    break;
                case 'xywh':
                    $raw = rawurldecode($v);
                    $percent = str_starts_with($raw, 'percent:');
                    if ($percent) {
                        $raw = substr($raw, 8);
                    } elseif (str_starts_with($raw, 'pixel:')) {
                        break;
                    }
                    $l['xywh'] = array_map(
                        fn ($x) => self::number((string) Json::round6(((float) $x) / ($percent ? 100 : 1))),
                        explode(',', $raw),
                    );
                    break;
            }
        }
        return ['docref' => $docref, 'locator' => $l];
    }

    /** An anchor rebuilt from a locator (best effort; inverse of locator()). */
    public static function anchorFromLocator(array $l): ?array
    {
        $a = null;
        if (isset($l['p'])) {
            $a = ['type' => 'page', 'physical' => $l['p'], 'printed' => $l['f'] ?? null];
        } elseif (isset($l['t'])) {
            $a = ['type' => 'time', 't0' => $l['t'][0], 't1' => $l['t'][1] ?? $l['t'][0]];
        } elseif (isset($l['v'])) {
            $a = ['type' => 'verse', 'line_from' => $l['v'][0]];
            if (isset($l['v'][1])) {
                $a['line_to'] = $l['v'][1];
            }
            if (isset($l['f'])) {
                $a['printed'] = $l['f'];
            }
        } elseif (isset($l['s']) || isset($l['para'])) {
            $a = ['type' => 'section', 'path' => $l['s'] ?? []];
            if (isset($l['para'])) {
                $a['paragraph'] = $l['para'];
            }
            if (isset($l['f'])) {
                $a['printed'] = $l['f'];
            }
        } elseif (isset($l['sl'])) {
            $a = ['type' => 'slide', 'n' => $l['sl']];
        } elseif (isset($l['sh'])) {
            $a = ['type' => 'sheet', 'sheet' => $l['sh'], 'row_from' => $l['rows'][0] ?? null, 'row_to' => $l['rows'][1] ?? null];
        } elseif (isset($l['ref'])) {
            $a = ['type' => 'canonical', 'scheme' => $l['ref']['scheme'], 'ref' => $l['ref']['ref']];
        } elseif (isset($l['xywh'])) {
            $a = ['type' => 'image'];
        }
        if ($a === null) {
            return null;
        }
        if (isset($l['char'])) {
            $a['chars'] = $l['char'];
        }
        if (isset($l['xywh'])) {
            [$x, $y, $w, $h] = array_pad($l['xywh'], 4, 0);
            $a['region'] = ['x' => $x, 'y' => $y, 'w' => $w, 'h' => $h];
        }
        return $a;
    }

    private static function str(mixed $v): ?string
    {
        if ($v === null || $v === '') {
            return null;
        }
        return is_scalar($v) ? (string) $v : null;
    }

    private static function number(string $s): int|float
    {
        $f = (float) $s;
        return (preg_match('/^-?\d+$/', $s) && abs($f) < 2 ** 53) ? (int) $s : $f;
    }
}
