<?php

declare(strict_types=1);

namespace Spdf\Conformance;

use Spdf\AnchorUri;
use Spdf\Cite;
use Spdf\Document;
use Spdf\Json;
use Spdf\SpdfException;
use Spdf\Validator;
use Spdf\Writer;

/**
 * Runs the conformance suite (`conformance/cases/*.json`, contract §11) and prints
 * `{"impl","version","passed":[…],"failed":[{"id","reason"}],"skipped":[…]}`.
 */
final class Runner
{
    public const IMPL = 'php';
    public const VERSION = '0.1.0';
    public const TOLERANCE = 1e-6;

    public function __construct(private readonly string $dir)
    {
    }

    public function run(): array
    {
        $passed = [];
        $failed = [];
        $skipped = [];
        $files = glob(rtrim($this->dir, '/') . '/cases/*.json') ?: [];
        sort($files, SORT_STRING);
        foreach ($files as $file) {
            $case = Json::decode((string) file_get_contents($file));
            $id = (string) ($case['id'] ?? basename($file, '.json'));
            try {
                $reason = $this->runCase($case);
                if ($reason === null) {
                    $passed[] = $id;
                } elseif ($reason === 'skip') {
                    $skipped[] = $id;
                } else {
                    $failed[] = ['id' => $id, 'reason' => $reason];
                }
            } catch (\Throwable $e) {
                $failed[] = ['id' => $id, 'reason' => get_class($e) . ': ' . $e->getMessage()];
            }
        }
        return ['impl' => self::IMPL, 'version' => self::VERSION, 'passed' => $passed, 'failed' => $failed, 'skipped' => $skipped];
    }

    private function path(string $rel): string
    {
        return rtrim($this->dir, '/') . '/' . $rel;
    }

    /** Returns null on success, 'skip', or the failure reason. */
    private function runCase(array $case): ?string
    {
        $kind = (string) ($case['kind'] ?? '');
        $in = $case['input'] ?? [];
        $expect = $case['expect'] ?? [];
        switch ($kind) {
            case 'dump':
            case 'legacy_dump':
                $actual = Document::open($this->path($in['file']))->dump();
                $want = isset($expect['dump_file']) ? Json::decode((string) file_get_contents($this->path($expect['dump_file']))) : ($expect['dump'] ?? $expect);
                return self::compare($want, $actual, 'dump');
            case 'validate':
                $r = Validator::validate($this->path($in['file']));
                return self::compareValidation($expect, $r);
            default:
                return "unknown case kind {$kind}";
        }
    }

    /** Structural comparison; numbers within TOLERANCE. Returns null or a reason. */
    public static function compare(mixed $want, mixed $got, string $path = '$'): ?string
    {
        $want = self::norm($want);
        $got = self::norm($got);
        if ((is_int($want) || is_float($want)) && (is_int($got) || is_float($got))) {
            return abs((float) $want - (float) $got) <= self::TOLERANCE ? null : "{$path}: expected {$want}, got {$got}";
        }
        if (is_array($want) && is_array($got)) {
            $wl = array_is_list($want);
            $gl = array_is_list($got);
            if ($want === [] || $got === []) {
                return $want === $got ? null : "{$path}: expected " . Json::canonical($want) . ', got ' . self::short($got);
            }
            if ($wl !== $gl) {
                return "{$path}: list/object mismatch";
            }
            if ($wl) {
                if (count($want) !== count($got)) {
                    return "{$path}: expected " . count($want) . ' items, got ' . count($got);
                }
                foreach ($want as $i => $w) {
                    $r = self::compare($w, $got[$i], "{$path}[{$i}]");
                    if ($r !== null) {
                        return $r;
                    }
                }
                return null;
            }
            foreach ($want as $k => $w) {
                if (!array_key_exists($k, $got)) {
                    return "{$path}.{$k}: missing";
                }
                $r = self::compare($w, $got[$k], "{$path}.{$k}");
                if ($r !== null) {
                    return $r;
                }
            }
            foreach ($got as $k => $_) {
                if (!array_key_exists($k, $want)) {
                    return "{$path}.{$k}: unexpected key";
                }
            }
            return null;
        }
        return $want === $got ? null : "{$path}: expected " . self::short($want) . ', got ' . self::short($got);
    }

    private static function norm(mixed $v): mixed
    {
        if ($v instanceof \stdClass) {
            return [];
        }
        return $v;
    }

    private static function short(mixed $v): string
    {
        $s = Json::canonical($v instanceof \stdClass ? [] : $v);
        return strlen($s) > 200 ? substr($s, 0, 200) . '…' : $s;
    }

    private static function compareValidation(array $expect, array $r): ?string
    {
        if (array_key_exists('valid', $expect) && $expect['valid'] !== $r['valid']) {
            return 'valid: expected ' . json_encode($expect['valid']) . ', got ' . json_encode($r['valid'])
                . ' (errors ' . implode(',', array_column($r['errors'], 'code')) . ')';
        }
        foreach (['errors', 'warnings'] as $k) {
            if (!array_key_exists($k, $expect)) {
                continue;
            }
            $want = array_map(fn ($e) => is_array($e) ? $e['code'] : $e, $expect[$k]);
            $got = array_column($r[$k], 'code');
            $w = array_values(array_unique($want));
            $g = array_values(array_unique($got));
            sort($w);
            sort($g);
            if ($w !== $g) {
                return "{$k}: expected [" . implode(',', $w) . '], got [' . implode(',', $g) . ']';
            }
        }
        return null;
    }

    /**
     * One request of the `spdf eval` test protocol (used by differential tests).
     *
     * @param array<string,mixed> $q
     */
    public static function evaluate(array $q): mixed
    {
        $doc = fn () => Document::open((string) $q['file']);
        return match ($q['op'] ?? '') {
            'dump' => $doc()->dump(),
            'validate' => Validator::validate((string) $q['file']),
            'lexical' => $doc()->searchLexical((string) $q['query'], (int) ($q['limit'] ?? 10)),
            'vector' => $doc()->searchVector($q['vector'], (string) $q['space'], (int) ($q['limit'] ?? 10), (string) ($q['target'] ?? 'fragment')),
            'hybrid' => $doc()->searchHybrid((string) $q['query'], $q['vector'], (string) $q['space'], (int) ($q['limit'] ?? 10)),
            'uri' => AnchorUri::fromAnchor((string) $q['docref'], $q['anchor'], $q['end'] ?? null),
            'format_locator' => AnchorUri::format((string) $q['docref'], $q['locator'] instanceof \stdClass ? [] : $q['locator']),
            'parse_uri' => (function () use ($q) {
                $r = AnchorUri::parse((string) $q['uri']);
                if ($r['locator'] === []) {
                    $r['locator'] = new \stdClass();
                }
                return $r;
            })(),
            'cite' => Cite::short($q['metadata'] instanceof \stdClass ? [] : $q['metadata'], $q['anchor'], $q['end'] ?? null, (string) ($q['locale'] ?? 'es')),
            'write' => (function () use ($q) {
                Writer::fromSource($q['source'], (string) $q['path']);
                return Document::open((string) $q['path'])->dump();
            })(),
            'csl' => $doc()->cslItem(),
            'bibtex' => $doc()->bibtex(),
            default => throw new SpdfException('E000', 'unknown op ' . json_encode($q['op'] ?? null)),
        };
    }
}
