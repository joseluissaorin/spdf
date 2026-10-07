<?php

declare(strict_types=1);

namespace Spdf;

/** Unicode helpers: NFC, folding for search, code-point slicing. */
final class Text
{
    public static function nfc(string $s): string
    {
        $n = \Normalizer::normalize($s, \Normalizer::FORM_C);
        return $n === false ? $s : $n;
    }

    /** Deduplication key of a search term: lower(remove_Mn(NFD(term))). */
    public static function dedupKey(string $s): string
    {
        $d = \Normalizer::normalize($s, \Normalizer::FORM_D);
        if ($d === false) {
            $d = $s;
        }
        $d = preg_replace('/\p{Mn}+/u', '', $d) ?? $d;
        return mb_strtolower($d, 'UTF-8');
    }

    /** Words: maximal runs of Unicode L, M or N. @return list<string> */
    public static function words(string $s): array
    {
        if (!preg_match_all('/[\p{L}\p{M}\p{N}]+/u', $s, $m)) {
            return [];
        }
        return $m[0];
    }

    /** An FTS5 string literal. */
    public static function ftsString(string $s): string
    {
        return '"' . str_replace('"', '""', $s) . '"';
    }

    private const QUOTES = ['"' => ['"'], '“' => ['”'], '«' => ['»'], '„' => ['“', '”']];

    /**
     * Parses a user query into search terms (contract §6, steps 1-4).
     *
     * @return array{terms:list<string>, phrases:bool, cjk:bool}
     */
    public static function queryTerms(string $query): array
    {
        $q = self::nfc($query);
        $chars = mb_str_split($q, 1, 'UTF-8');
        $n = count($chars);
        $phrases = [];
        $loose = '';
        for ($i = 0; $i < $n; $i++) {
            $c = $chars[$i];
            if (isset(self::QUOTES[$c])) {
                $j = $i + 1;
                while ($j < $n && !in_array($chars[$j], self::QUOTES[$c], true)) {
                    $j++;
                }
                if ($j < $n) {
                    $words = self::words(implode('', array_slice($chars, $i + 1, $j - $i - 1)));
                    if ($words !== []) {
                        $phrases[] = implode(' ', $words);
                    }
                    $loose .= ' ';
                    $i = $j;
                    continue;
                }
                $loose .= ' ';
                continue;
            }
            $loose .= $c;
        }
        $isPhrase = $phrases !== [];
        $candidates = $isPhrase ? $phrases : self::words($loose);
        $seen = [];
        $terms = [];
        foreach ($candidates as $t) {
            $k = self::dedupKey($t);
            if (!isset($seen[$k])) {
                $seen[$k] = true;
                $terms[] = $t;
            }
        }
        return ['terms' => $terms, 'phrases' => $isPhrase, 'cjk' => self::isCjk($q)];
    }

    /** The FTS5 MATCH expression for a list of terms (null when there are none). */
    public static function ftsMatch(array $terms, bool $phrases): ?string
    {
        if ($terms === []) {
            return null;
        }
        return implode($phrases ? ' AND ' : ' OR ', array_map([self::class, 'ftsString'], $terms));
    }

    /** Convenience: the reference MATCH expression for a user query. */
    public static function ftsQuery(string $query): ?string
    {
        $p = self::queryTerms($query);
        return self::ftsMatch($p['terms'], $p['phrases']);
    }

    /** True if the text holds a code point of the CJK ranges of contract §6. */
    public static function isCjk(string $s): bool
    {
        return preg_match('/[\x{2E80}-\x{2FDF}\x{3040}-\x{30FF}\x{3100}-\x{312F}\x{3130}-\x{318F}'
            . '\x{31A0}-\x{31FF}\x{3400}-\x{4DBF}\x{4E00}-\x{9FFF}\x{A960}-\x{A97F}\x{AC00}-\x{D7AF}'
            . '\x{F900}-\x{FAFF}\x{FF66}-\x{FF9F}\x{20000}-\x{3FFFF}]/u', $s) === 1;
    }

    public static function length(string $s): int
    {
        return mb_strlen($s, 'UTF-8');
    }

    /** Substring by code points, end exclusive. */
    public static function slice(string $s, int $start, int $end): string
    {
        return mb_substr($s, $start, max(0, $end - $start), 'UTF-8');
    }
}
