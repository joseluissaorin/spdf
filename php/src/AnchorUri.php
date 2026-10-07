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
        $endType = $end['type'] ?? null;
        switch ($type) {
            case 'page':
                $l['p'] = $a['physical'] ?? null;
                if (($a['printed'] ?? null) !== null) {
                    $l['f'] = (string) $a['printed'];
                }
                if ($end !== null && $endType === 'page') {
                    if (($end['physical'] ?? null) !== null && $end['physical'] != ($a['physical'] ?? null)) {
                        $l['pe'] = $end['physical'];
                    }
                    if (($end['printed'] ?? null) !== null && $end['printed'] !== ($a['printed'] ?? null)) {
                        $l['fe'] = (string) $end['printed'];
                    }
                }
                break;
            case 'time':
                $t1 = ($end !== null && $endType === 'time') ? ($end['t1'] ?? null) : ($a['t1'] ?? null);
                $l['t'] = $t1 === null ? [$a['t0'] ?? 0] : [$a['t0'] ?? 0, $t1];
                break;
            case 'section':
            case 'web':
                if (isset($a['path']) && is_array($a['path']) && $a['path'] !== []) {
                    $l['s'] = array_map('strval', array_values($a['path']));
                }
                if (($a['paragraph'] ?? null) !== null) {
                    $l['para'] = $a['paragraph'];
                }
                if (($a['printed'] ?? null) !== null) {
                    $l['f'] = (string) $a['printed'];
                    if ($end !== null && ($end['printed'] ?? null) !== null && $end['printed'] !== $a['printed']) {
                        $l['fe'] = (string) $end['printed'];
                    }
                }
                break;
            case 'slide':
                $l['sl'] = $a['n'] ?? null;
                break;
            case 'sheet':
                $l['sh'] = (string) ($a['sheet'] ?? '');
                $l['rows'] = [$a['row_from'] ?? null, $a['row_to'] ?? null];
                break;
            case 'verse':
                $from = $a['line_from'] ?? null;
                $to = $a['line_to'] ?? null;
                $l['v'] = $to === null || $to == $from ? [$from] : [$from, $to];
                if (($a['printed'] ?? null) !== null) {
                    $l['f'] = (string) $a['printed'];
                }
                break;
            case 'canonical':
                $l['ref'] = ['scheme' => (string) ($a['scheme'] ?? ''), 'ref' => (string) ($a['ref'] ?? '')];
                break;
        }
        if (($a['chars'] ?? null) !== null && is_array($a['chars'])) {
            $l['char'] = array_values($a['chars']);
        }
        if (($a['region'] ?? null) !== null && is_array($a['region'])) {
            $r = $a['region'];
            $l['xywh'] = [$r['x'] ?? 0, $r['y'] ?? 0, $r['w'] ?? 0, $r['h'] ?? 0];
        }
        return $l;
    }

    /** Formats a locator as the canonical URI. */
    public static function format(string $docref, array $locator): string
    {
        $parts = [];
        $int = fn ($x) => is_float($x) && floor($x) == $x ? (string) (int) $x : (string) $x;
        foreach (self::ORDER as $k) {
            if (!array_key_exists($k, $locator)) {
                continue;
            }
            $v = $locator[$k];
            $parts[] = $k . '=' . match ($k) {
                'p', 'pe', 'para', 'sl' => $int($v),
                'f', 'fe', 'sh' => rawurlencode((string) $v),
                't' => implode(',', array_map(fn ($x) => Json::number((float) $x), (array) $v)),
                's' => implode('/', array_map(fn ($x) => rawurlencode((string) $x), (array) $v)),
                'rows' => $int($v[0] ?? '') . '-' . $int($v[1] ?? ''),
                'v' => implode('-', array_map($int, (array) $v)),
                'ref' => rawurlencode((string) ($v['scheme'] ?? '')) . ':' . rawurlencode((string) ($v['ref'] ?? '')),
                'char' => $int($v[0] ?? '') . ',' . $int($v[1] ?? ''),
                'xywh' => 'percent:' . implode(',', array_map(
                    fn ($x) => Json::number((float) sprintf('%.4F', ((float) $x) * 100)),
                    (array) $v,
                )),
            };
        }
        $ref = preg_match('/^sha256-[0-9a-f]{64}$/', $docref) ? $docref : rawurlencode($docref);
        $uri = 'spdf:' . $ref;
        return $parts === [] ? $uri : $uri . '#' . implode('&', $parts);
    }

    /**
     * Parses an anchor URI. Throws SpdfException (E040) on malformed input.
     *
     * @return array{docref:string, locator:array}
     */
    public static function parse(string $uri): array
    {
        $bad = fn (string $why) => new SpdfException('E040', "Bad anchor URI ({$why}): {$uri}");
        if (!str_starts_with($uri, 'spdf:')) {
            throw $bad('not an spdf: URI');
        }
        $rest = substr($uri, 5);
        $hash = strpos($rest, '#');
        $docrefRaw = $hash === false ? $rest : substr($rest, 0, $hash);
        $frag = $hash === false ? '' : substr($rest, $hash + 1);
        if ($docrefRaw === '') {
            throw $bad('empty document reference');
        }
        $docref = self::dec($docrefRaw, $bad);
        $l = [];
        foreach ($frag === '' ? [] : explode('&', $frag) as $part) {
            if ($part === '') {
                continue;
            }
            $eq = strpos($part, '=');
            if ($eq === false) {
                throw $bad("parameter without value: {$part}");
            }
            $k = substr($part, 0, $eq);
            $v = substr($part, $eq + 1);
            if (array_key_exists($k, $l)) {
                throw $bad("duplicate parameter {$k}");
            }
            switch ($k) {
                case 'p':
                case 'pe':
                case 'para':
                case 'sl':
                    $l[$k] = self::int($v, $bad);
                    if ($k !== 'para' && $l[$k] < 1) {
                        throw $bad("{$k} starts at 1");
                    }
                    break;
                case 'f':
                case 'fe':
                case 'sh':
                    $l[$k] = self::dec($v, $bad);
                    break;
                case 't':
                    if (str_starts_with($v, 'npt:')) {
                        $v = substr($v, 4);
                    }
                    $xs = array_map(fn ($x) => self::npt($x, $bad), explode(',', $v));
                    if (count($xs) > 2 || (count($xs) === 2 && $xs[1] < $xs[0])) {
                        throw $bad('bad t');
                    }
                    $l['t'] = $xs;
                    break;
                case 's':
                    $l['s'] = array_map(fn ($e) => self::dec($e, $bad), explode('/', $v));
                    break;
                case 'rows':
                    $dash = strpos($v, '-');
                    if ($dash === false) {
                        throw $bad('rows needs a-b');
                    }
                    $l['rows'] = [self::int(substr($v, 0, $dash), $bad), self::int(substr($v, $dash + 1), $bad)];
                    break;
                case 'v':
                    $xs = array_map(fn ($x) => self::int($x, $bad), explode('-', $v));
                    if (count($xs) > 2) {
                        throw $bad('bad v');
                    }
                    $l['v'] = $xs;
                    break;
                case 'ref':
                    $colon = strpos($v, ':');
                    if ($colon === false || $colon === 0) {
                        throw $bad('ref needs scheme:ref');
                    }
                    $l['ref'] = ['scheme' => self::dec(substr($v, 0, $colon), $bad), 'ref' => self::dec(substr($v, $colon + 1), $bad)];
                    break;
                case 'char':
                    $xs = explode(',', $v);
                    if (count($xs) !== 2) {
                        throw $bad('char needs start,end');
                    }
                    $a = self::int($xs[0], $bad);
                    $b = self::int($xs[1], $bad);
                    if ($b < $a) {
                        throw $bad('char end before start');
                    }
                    $l['char'] = [$a, $b];
                    break;
                case 'xywh':
                    if (!str_starts_with($v, 'percent:')) {
                        throw $bad('xywh must use percent:');
                    }
                    $xs = explode(',', substr($v, 8));
                    if (count($xs) !== 4) {
                        throw $bad('bad xywh');
                    }
                    foreach ($xs as $x) {
                        if (!preg_match('/^[0-9]+(\.[0-9]+)?$/', $x)) {
                            throw $bad('bad xywh');
                        }
                    }
                    $l['xywh'] = array_map(fn ($x) => self::canonNumber(Json::round6(((float) $x) / 100)), $xs);
                    break;
                default:
                    // unknown keys are ignored
            }
        }
        return ['docref' => $docref, 'locator' => $l];
    }

    private static function dec(string $s, \Closure $bad): string
    {
        if (preg_match('/%(?![0-9A-Fa-f]{2})/', $s)) {
            throw $bad('bad percent-encoding');
        }
        $d = rawurldecode($s);
        if (!mb_check_encoding($d, 'UTF-8')) {
            throw $bad('percent-encoding is not UTF-8');
        }
        return $d;
    }

    private static function int(string $s, \Closure $bad): int
    {
        if (!preg_match('/^(0|[1-9][0-9]*)$/', $s)) {
            throw $bad("not an integer: {$s}");
        }
        return (int) $s;
    }

    private static function npt(string $s, \Closure $bad): int|float
    {
        if (preg_match('/^[0-9]+(\.[0-9]+)?$/', $s)) {
            return self::canonNumber((float) $s);
        }
        if (!preg_match('/^(?:([0-9]+):)?([0-5]?[0-9]):([0-5][0-9](?:\.[0-9]+)?)$/', $s, $m)) {
            throw $bad("bad time: {$s}");
        }
        $h = $m[1] === '' ? 0 : (int) $m[1];
        return self::canonNumber(Json::round6($h * 3600 + (int) $m[2] * 60 + (float) $m[3]));
    }

    /** Integral floats as int (as the canonical form does). */
    private static function canonNumber(float $f): int|float
    {
        $r = Json::round6($f);
        return floor($r) == $r && abs($r) < 2 ** 53 ? (int) $r : $r;
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
}
