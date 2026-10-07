<?php

declare(strict_types=1);

namespace Spdf;

/** Bibliographic exports: CSL-JSON and BibTeX. */
final class Bibliography
{
    /** CSL type => BibTeX entry type. */
    private const BIBTEX_TYPES = [
        'book' => 'book', 'article-journal' => 'article', 'article-magazine' => 'article',
        'article-newspaper' => 'article', 'article' => 'article', 'chapter' => 'incollection',
        'paper-conference' => 'inproceedings', 'thesis' => 'phdthesis', 'report' => 'techreport',
        'manuscript' => 'unpublished', 'entry-encyclopedia' => 'incollection', 'entry-dictionary' => 'incollection',
    ];

    /** A CSL-JSON item with `id`; the `spdf` extension object is dropped unless asked. */
    public static function cslItem(array $metadata, string $id, bool $withExtension = false): array
    {
        $item = ['id' => $id] + $metadata;
        $item['id'] = $id;
        if (!$withExtension) {
            unset($item['spdf']);
        }
        return $item;
    }

    /** One BibTeX entry for a CSL item. */
    public static function bibtex(array $item): string
    {
        $type = self::BIBTEX_TYPES[$item['type'] ?? ''] ?? 'misc';
        $fields = [];
        $people = fn (string $k) => isset($item[$k]) && is_array($item[$k])
            ? implode(' and ', array_filter(array_map([self::class, 'bibName'], $item[$k])))
            : '';
        foreach (['author' => 'author', 'editor' => 'editor', 'translator' => 'translator'] as $csl => $bib) {
            $v = $people($csl);
            if ($v !== '') {
                $fields[$bib] = $v;
            }
        }
        if (isset($item['title'])) {
            $fields['title'] = (string) $item['title'];
        }
        $container = $item['container-title'] ?? null;
        if (is_string($container) && $container !== '') {
            $fields[$type === 'article' ? 'journal' : 'booktitle'] = $container;
        }
        $parts = $item['issued']['date-parts'][0] ?? [];
        if (isset($parts[0])) {
            $fields['year'] = (string) $parts[0];
            if (isset($parts[1])) {
                $fields['month'] = (string) $parts[1];
            }
        }
        $map = [
            'publisher' => 'publisher', 'publisher-place' => 'address', 'collection-title' => 'series',
            'volume' => 'volume', 'issue' => 'number', 'page' => 'pages', 'edition' => 'edition',
            'DOI' => 'doi', 'ISBN' => 'isbn', 'URL' => 'url', 'language' => 'language', 'abstract' => 'abstract',
            'original-title' => 'origtitle',
        ];
        foreach ($map as $csl => $bib) {
            if (isset($item[$csl]) && is_scalar($item[$csl]) && (string) $item[$csl] !== '') {
                $fields[$bib] = (string) $item[$csl];
            }
        }
        if ($type === 'phdthesis' && isset($fields['publisher'])) {
            $fields['school'] = $fields['publisher'];
            unset($fields['publisher']);
        }
        if ($type === 'techreport' && isset($fields['publisher'])) {
            $fields['institution'] = $fields['publisher'];
            unset($fields['publisher']);
        }
        if (isset($fields['pages'])) {
            $fields['pages'] = preg_replace('/(?<=\d)\s*[-–]\s*(?=\d)/u', '--', $fields['pages']);
        }
        $lines = ['@' . $type . '{' . self::key($item) . ','];
        foreach ($fields as $k => $v) {
            $value = in_array($k, ['url', 'doi'], true) ? $v : self::escape($v);
            $lines[] = '  ' . $k . ' = {' . $value . '},';
        }
        $lines[] = '}';
        return implode("\n", $lines) . "\n";
    }

    private static function bibName(mixed $p): ?string
    {
        if (!is_array($p)) {
            return null;
        }
        if (isset($p['literal'])) {
            return '{' . $p['literal'] . '}';
        }
        $family = trim((($p['non-dropping-particle'] ?? '') . ' ' . ($p['family'] ?? '')));
        $given = trim((($p['given'] ?? '') . ' ' . ($p['dropping-particle'] ?? '')));
        if ($family === '' && $given === '') {
            return null;
        }
        if ($family === '') {
            return $given;
        }
        return $given === '' ? $family : "{$family}, {$given}";
    }

    /** Citation key: family name of the first author + year + first title word (ASCII). */
    public static function key(array $item): string
    {
        $who = '';
        foreach (['author', 'editor'] as $k) {
            if (isset($item[$k][0]) && is_array($item[$k][0])) {
                $who = (string) ($item[$k][0]['family'] ?? $item[$k][0]['literal'] ?? $item[$k][0]['given'] ?? '');
                break;
            }
        }
        $year = (string) ($item['issued']['date-parts'][0][0] ?? '');
        $word = '';
        foreach (Text::words((string) ($item['title'] ?? '')) as $w) {
            if (mb_strlen($w, 'UTF-8') > 3) {
                $word = $w;
                break;
            }
        }
        $key = self::ascii($who) . $year . self::ascii($word);
        if ($key === '') {
            $key = self::ascii((string) ($item['id'] ?? 'spdf'));
        }
        return $key === '' ? 'spdf' : $key;
    }

    private static function ascii(string $s): string
    {
        $d = \Normalizer::normalize($s, \Normalizer::FORM_KD) ?: $s;
        $d = preg_replace('/\p{M}+/u', '', $d) ?? $d;
        $d = strtr($d, ['ß' => 'ss', 'æ' => 'ae', 'Æ' => 'AE', 'ø' => 'o', 'Ø' => 'O', 'œ' => 'oe', 'Œ' => 'OE', 'ł' => 'l', 'Ł' => 'L']);
        return preg_replace('/[^A-Za-z0-9]+/', '', $d) ?? '';
    }

    /** Escapes LaTeX specials; Unicode is kept (biber and modern BibTeX read UTF-8). */
    private static function escape(string $s): string
    {
        return strtr($s, [
            '\\' => '\\textbackslash{}', '{' => '\\{', '}' => '\\}', '&' => '\\&', '%' => '\\%', '$' => '\\$',
            '#' => '\\#', '_' => '\\_', '~' => '\\textasciitilde{}', '^' => '\\textasciicircum{}',
        ]);
    }
}
