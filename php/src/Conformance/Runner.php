<?php

declare(strict_types=1);

namespace Spdf\Conformance;

use Spdf\AnchorUri;
use Spdf\Cite;
use Spdf\Document;
use Spdf\Json;
use Spdf\SpdfException;
use Spdf\Validator;
use Spdf\Vectors;
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
                    $skipped[] = ['id' => $id, 'reason' => 'ALTO, TEI and IIIF exports (SPEC §19.4, optional) are not implemented'];
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

    private function json(string $rel): mixed
    {
        return Json::decode((string) file_get_contents($this->path($rel)));
    }

    /** Returns null on success, 'skip', or the failure reason. */
    private function runCase(array $case): ?string
    {
        $kind = (string) ($case['kind'] ?? '');
        $in = $case['input'] ?? [];
        $ex = $case['expect'] ?? [];
        switch ($kind) {
            case 'dump':
            case 'legacy_dump':
                $doc = Document::open($this->path($in['file']));
                $r = self::compare($this->json($ex['dump']), $doc->dump(), 'dump');
                if ($r !== null) {
                    return $r;
                }
                if (isset($ex['content_sha256']) && $doc->contentSha256() !== $ex['content_sha256']) {
                    return 'content_sha256: expected ' . $ex['content_sha256'] . ', got ' . $doc->contentSha256();
                }
                return null;
            case 'roundtrip':
                $tmp = tempnam(sys_get_temp_dir(), 'spdfrt');
                @unlink($tmp);
                $tmp .= '.spdf';
                try {
                    Writer::fromSource($this->json($in['source']), $tmp);
                    return self::compare($this->json($ex['dump']), Document::open($tmp)->dump(), 'dump');
                } finally {
                    @unlink($tmp);
                }
            case 'validate':
                return self::compareValidation($ex, Validator::validate($this->path($in['file'])));
            case 'search_lexical':
                $doc = Document::open($this->path($in['file']));
                $got = (new \Spdf\Search($doc))->lexicalDetailed((string) $in['query'], (int) ($in['limit'] ?? 10));
                foreach (['route', 'match'] as $k) {
                    if (array_key_exists($k, $ex) && $ex[$k] !== $got[$k]) {
                        return "{$k}: expected " . json_encode($ex[$k], JSON_UNESCAPED_UNICODE) . ', got ' . json_encode($got[$k], JSON_UNESCAPED_UNICODE);
                    }
                }
                return self::compareResults($ex['results'], $got['results'], true);
            case 'search_vector':
                $doc = Document::open($this->path($in['file']));
                $got = $doc->searchVector($in['query_vector'], (string) $in['space'], (int) ($in['limit'] ?? 10), (string) ($in['target'] ?? 'fragment'));
                return self::compareResults($ex['results'], $got, false);
            case 'search_hybrid':
                $doc = Document::open($this->path($in['file']));
                $got = $doc->searchHybrid((string) $in['query'], $in['query_vector'], (string) $in['space'], (int) ($in['limit'] ?? 10));
                return self::compareResults($ex['results'], $got, true);
            case 'anchor_uri':
                return self::anchorUriCase($in, $ex);
            case 'quantize':
                try {
                    $hex = bin2hex(Vectors::encode($in['values'], (string) $in['dtype']));
                } catch (SpdfException $e) {
                    return ($ex['error'] ?? false) === true ? null : 'unexpected error: ' . $e->getMessage();
                }
                if (($ex['error'] ?? false) === true) {
                    return "expected an error, got {$hex}";
                }
                return $hex === $ex['hex'] ? null : "expected {$ex['hex']}, got {$hex}";
            case 'locate':
                $doc = Document::open($this->path($in['file']));
                try {
                    $got = $doc->locate((string) $in['reference']);
                } catch (SpdfException $e) {
                    $got = ['document' => false, 'units' => [], 'fragments' => [], 'char' => null, 'xywh' => null];
                }
                return self::compare($ex, $got, 'locate');
            case 'export_csl':
                $metas = array_map(fn ($f) => Document::open($this->path($f))->metadata(), $in['files']);
                $anchor = is_array($in['anchor'] ?? null) ? $in['anchor'] : null;
                $end = is_array($in['anchor_end'] ?? null) ? $in['anchor_end'] : null;
                return self::compare($ex['items'], \Spdf\Bibliography::cslItems($metas, $anchor, $end), 'items');
            case 'export_bibtex':
                $metas = array_map(fn ($f) => Document::open($this->path($f))->metadata(), $in['files']);
                $want = self::bibLines((string) $ex['text']);
                $got = self::bibLines(\Spdf\Bibliography::bibtexAll($metas));
                foreach ($want as $i => $line) {
                    if (($got[$i] ?? null) !== $line) {
                        return "line " . ($i + 1) . ": expected {$line}, got " . ($got[$i] ?? '(nothing)');
                    }
                }
                return count($got) === count($want) ? null : 'expected ' . count($want) . ' lines, got ' . count($got);
            case 'export_structure':
                return 'skip';
            case 'cite':
                $meta = $in['metadata'] instanceof \stdClass ? [] : (array) $in['metadata'];
                $end = is_array($in['anchor_end'] ?? null) ? $in['anchor_end'] : null;
                $text = Cite::short($meta, $in['anchor'], $end, (string) ($in['locale'] ?? 'en'));
                return $text === $ex['text'] ? null : 'expected ' . $ex['text'] . ', got ' . $text;
            default:
                return "unknown case kind {$kind}";
        }
    }

    private static function anchorUriCase(array $in, array $ex): ?string
    {
        if (isset($in['uri'])) {
            if (($ex['error'] ?? false) === true) {
                try {
                    $r = AnchorUri::parse((string) $in['uri']);
                    return 'expected a parse error, got ' . Json::canonical($r['locator'] === [] ? new \stdClass() : $r['locator']);
                } catch (SpdfException) {
                    return null;
                }
            }
            $p = AnchorUri::parse((string) $in['uri']);
            if ($p['docref'] !== $ex['docref']) {
                return "docref: expected {$ex['docref']}, got {$p['docref']}";
            }
            $r = self::compare($ex['locator'], $p['locator'], 'locator');
            if ($r !== null) {
                return $r;
            }
            $f = AnchorUri::format($p['docref'], $p['locator']);
            return $f === $ex['canonical'] ? null : "format(parse(uri)): expected {$ex['canonical']}, got {$f}";
        }
        $end = is_array($in['anchor_end'] ?? null) ? $in['anchor_end'] : null;
        $uri = AnchorUri::fromAnchor((string) $in['docref'], $in['anchor'], $end);
        if ($uri !== $ex['uri']) {
            return "uri: expected {$ex['uri']}, got {$uri}";
        }
        $p = AnchorUri::parse($uri);
        if ($p['docref'] !== $in['docref']) {
            return "parse(uri).docref: expected {$in['docref']}, got {$p['docref']}";
        }
        $r = self::compare($ex['locator'], $p['locator'], 'locator');
        if ($r !== null) {
            return $r;
        }
        $f = AnchorUri::format($p['docref'], $p['locator']);
        return $f === $uri ? null : "format(parse(uri)): expected {$uri}, got {$f}";
    }

    /** @return list<string> */
    private static function bibLines(string $text): array
    {
        $out = [];
        foreach (explode("\n", str_replace("\r\n", "\n", $text)) as $line) {
            $t = trim($line);
            if ($t !== '') {
                $out[] = $t;
            }
        }
        return $out;
    }

    private static function compareResults(array $want, array $got, bool $via): ?string
    {
        if (count($want) !== count($got)) {
            return 'results: expected ' . count($want) . ', got ' . count($got);
        }
        foreach ($want as $i => $w) {
            $g = $got[$i];
            foreach (['fragment_id', 'unit_id', 'figure_id'] as $idKey) {
                if (array_key_exists($idKey, $w) && ($w[$idKey] !== ($g[$idKey] ?? null))) {
                    return "results[{$i}].{$idKey}: expected {$w[$idKey]}, got " . ($g[$idKey] ?? 'nothing');
                }
            }
            if (abs((float) $w['score'] - (float) $g['score']) > self::TOLERANCE) {
                return "results[{$i}].score: expected {$w['score']}, got {$g['score']}";
            }
            if ($w['anchor_uri'] !== $g['anchor_uri']) {
                return "results[{$i}].anchor_uri: expected {$w['anchor_uri']}, got {$g['anchor_uri']}";
            }
            if ($via && isset($w['via']) && $w['via'] !== $g['via']) {
                return "results[{$i}].via: expected " . implode(',', $w['via']) . ', got ' . implode(',', $g['via']);
            }
        }
        return null;
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
        if (array_key_exists('version', $expect) && $expect['version'] !== $r['version']) {
            return 'version: expected ' . json_encode($expect['version']) . ', got ' . json_encode($r['version']);
        }
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
