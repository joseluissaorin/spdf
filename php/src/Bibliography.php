<?php

declare(strict_types=1);

namespace Spdf;

/**
 * Bibliographic exports (specification §19): CSL-JSON and BibTeX.
 *
 * CSL-JSON: the metadata item without its `spdf` member, `id` = BibTeX key.
 * BibTeX key: first author's family name (or the first word of the title) folded to
 * ASCII letters and lowercased, plus the year (or `nd`); collisions inside one export
 * get `a`, `b`, `c`… Exports never invent data.
 */
final class Bibliography
{
    private const TYPES = [
        'book' => 'book', 'article-journal' => 'article', 'article-magazine' => 'article',
        'article-newspaper' => 'article', 'chapter' => 'incollection', 'paper-conference' => 'inproceedings',
        'thesis' => 'phdthesis', 'report' => 'techreport',
    ];

    private const FIELDS = [
        'publisher' => 'publisher', 'publisher-place' => 'address', 'collection-title' => 'series',
        'volume' => 'volume', 'issue' => 'number', 'page' => 'pages', 'edition' => 'edition', 'DOI' => 'doi',
        'ISBN' => 'isbn', 'URL' => 'url', 'language' => 'language', 'note' => 'note',
    ];

    /** The CSL item without `spdf`, with `id` = BibTeX key. */
    public static function cslItem(array $metadata): array
    {
        $item = self::base($metadata);
        $item['id'] = self::key($item);
        return $item;
    }

    /**
     * CSL-JSON export of several metadata records (keys disambiguated, SPEC §19.2). With
     * an anchor and a single record, the item carries the CSL `label` and `locator`.
     *
     * @return list<array>
     */
    public static function cslItems(array $metadatas, ?array $anchor = null, ?array $anchorEnd = null): array
    {
        $items = array_map([self::class, 'base'], array_values($metadatas));
        foreach (self::keys($items) as $i => $k) {
            $items[$i]['id'] = $k;
        }
        if ($anchor !== null && count($items) === 1) {
            $ll = Cite::cslLocator($anchor, $anchorEnd);
            if ($ll !== null) {
                [$items[0]['label'], $items[0]['locator']] = $ll;
            }
        }
        return $items;
    }

    private static function base(array $m): array
    {
        unset($m['spdf']);
        return $m;
    }

    private static function asciiLetters(string $s): string
    {
        $d = \Normalizer::normalize($s, \Normalizer::FORM_KD);
        $d = preg_replace('/\p{Mn}+/u', '', $d === false ? $s : $d) ?? $s;
        return strtolower(preg_replace('/[^A-Za-z]/', '', $d) ?? '');
    }

    /** First year of `issued` in decimal (negative years keep their sign), or null. */
    private static function year(array $item): ?string
    {
        $y = $item['issued']['date-parts'][0][0] ?? null;
        if ($y === null || is_bool($y) || is_array($y)) {
            return null;
        }
        if (is_int($y) || is_float($y)) {
            return (string) (int) $y;
        }
        if (is_string($y) && preg_match('/^\s*-?\d+\s*$/', $y)) {
            return (string) (int) trim($y);
        }
        return null;
    }

    /**
     * Base key (SPEC §19.1): the first author's family, literal or given name, else the
     * first word of `title-short` or `title`, folded to ASCII letters; `anon` if nothing is
     * left; then the first year of `issued` or `nd`.
     */
    public static function key(array $item): string
    {
        $base = '';
        $a = $item['author'][0] ?? null;
        if (is_array($a)) {
            $who = ($a['family'] ?? null) ?: (($a['literal'] ?? null) ?: (($a['given'] ?? null) ?: ''));
            $base = self::asciiLetters((string) $who);
        }
        if ($base === '') {
            $title = ($item['title-short'] ?? null) ?: (($item['title'] ?? null) ?: '');
            $words = preg_split('/\s+/u', trim((string) $title), -1, PREG_SPLIT_NO_EMPTY) ?: [];
            $base = $words === [] ? '' : self::asciiLetters($words[0]);
        }
        return ($base === '' ? 'anon' : $base) . (self::year($item) ?? 'nd');
    }

    /** @param list<array> $items @return list<string> */
    public static function keys(array $items): array
    {
        $bases = array_map([self::class, 'key'], $items);
        $counts = array_count_values($bases);
        $seen = [];
        $out = [];
        foreach ($bases as $b) {
            if ($counts[$b] === 1) {
                $out[] = $b;
                continue;
            }
            $n = $seen[$b] ?? 0;
            $seen[$b] = $n + 1;
            $out[] = $b . self::suffix($n);
        }
        return $out;
    }

    private static function suffix(int $n): string
    {
        $letters = '';
        $n++;
        while ($n > 0) {
            $r = ($n - 1) % 26;
            $n = intdiv($n - 1, 26);
            $letters = chr(97 + $r) . $letters;
        }
        return $letters;
    }

    private static function escape(string $s): string
    {
        return strtr($s, ['\\' => '\\textbackslash{}', '{' => '\\{', '}' => '\\}']);
    }

    /** Escapes and braces every word the source capitalizes. */
    private static function protectTitle(string $t): string
    {
        $parts = preg_split('/(\s+)/u', $t, -1, PREG_SPLIT_DELIM_CAPTURE) ?: [];
        $out = '';
        foreach ($parts as $tok) {
            $esc = self::escape($tok);
            $out .= preg_match('/\p{Lu}/u', $tok) ? '{' . $esc . '}' : $esc;
        }
        return $out;
    }

    private static function names(mixed $people): ?string
    {
        if (!is_array($people) || !array_is_list($people)) {
            return null;
        }
        $out = [];
        foreach ($people as $p) {
            if (!is_array($p)) {
                continue;
            }
            if (isset($p['literal']) && $p['literal'] !== '') {
                $out[] = '{' . self::escape((string) $p['literal']) . '}';
                continue;
            }
            $family = (string) ($p['family'] ?? '');
            $particle = (string) ($p['non-dropping-particle'] ?? '');
            if ($particle !== '' && $family !== '') {
                $family = "{$particle} {$family}";
            }
            $given = (string) ($p['given'] ?? '');
            if ($family !== '' && $given !== '') {
                $out[] = self::escape($family) . ', ' . self::escape($given);
            } elseif ($family !== '' || $given !== '') {
                $out[] = '{' . self::escape($family !== '' ? $family : $given) . '}';
            }
        }
        return $out === [] ? null : implode(' and ', $out);
    }

    /** One BibTeX entry of a CSL item. */
    public static function bibtex(array $item, ?string $key = null): string
    {
        $entry = self::TYPES[(string) ($item['type'] ?? '')] ?? 'misc';
        $fields = [];
        if (($v = self::names($item['author'] ?? null)) !== null) {
            $fields[] = ['author', $v];
        }
        if (($v = self::names($item['editor'] ?? null)) !== null) {
            $fields[] = ['editor', $v];
        }
        if (isset($item['title']) && $item['title'] !== '') {
            $fields[] = ['title', self::protectTitle((string) $item['title'])];
        }
        if (($y = self::year($item)) !== null) {
            $fields[] = ['year', $y];
        }
        if (isset($item['container-title']) && $item['container-title'] !== '') {
            $fields[] = [$entry === 'article' ? 'journal' : 'booktitle', self::protectTitle((string) $item['container-title'])];
        }
        foreach (self::FIELDS as $csl => $bib) {
            $v = $item[$csl] ?? null;
            if ($v === null || $v === '' || $v === []) {
                continue;
            }
            $fields[] = [$bib, self::escape(is_scalar($v) ? self::str($v) : Json::encode($v))];
        }
        $body = implode(",\n", array_map(fn ($f) => "  {$f[0]} = {{$f[1]}}", $fields));
        return '@' . $entry . '{' . ($key ?? self::key($item)) . ",\n" . $body . "\n}\n";
    }

    private static function str(mixed $v): string
    {
        if (is_bool($v)) {
            return $v ? 'True' : 'False';
        }
        if (is_float($v)) {
            return floor($v) == $v ? sprintf('%.1f', $v) : (string) $v;
        }
        return (string) $v;
    }

    /** BibTeX of several metadata records (keys disambiguated with a, b, c…). */
    public static function bibtexAll(array $metadatas): string
    {
        $items = array_map([self::class, 'base'], $metadatas);
        $keys = self::keys($items);
        return implode("\n", array_map(fn ($it, $k) => self::bibtex($it, $k), $items, $keys));
    }
}
