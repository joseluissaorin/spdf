<?php

declare(strict_types=1);

namespace Spdf;

/**
 * Reference search algorithms (contract §6). Products may rank better; these are
 * the ones the conformance suite checks.
 *
 * Result item: `{fragment_id, score, via, anchor, anchor_uri}` (vector search over
 * units or figures returns `{target, id, score, via, anchor, anchor_uri}`).
 */
final class Search
{
    public const RRF_K = 10;
    public const HYBRID_DEPTH = 50;

    public function __construct(private readonly Document $doc)
    {
    }

    /** @return list<array> */
    public function lexical(string $query, int $limit = 10): array
    {
        return array_map([self::class, 'public'], $this->lexicalRaw($query, $limit));
    }

    /** @param list<float> $query @return list<array> */
    public function vector(array $query, string $space, int $limit = 10, string $target = 'fragment'): array
    {
        return array_map([self::class, 'public'], $this->vectorRaw($query, $space, $limit, $target));
    }

    private function lexicalRaw(string $query, int $limit): array
    {
        $plan = Text::queryTerms($query);
        $terms = $plan['terms'];
        if ($terms === [] || $limit <= 0) {
            return [];
        }
        $match = Text::ftsMatch($terms, $plan['phrases']);
        $pdo = $this->doc->container()->pdo;
        $legacy = $this->doc->isLegacy();
        $hits = [];
        if ($plan['cjk']) {
            $long = true;
            foreach ($terms as $t) {
                if (mb_strlen($t, 'UTF-8') < 3) {
                    $long = false;
                }
            }
            if (!$legacy && $this->doc->container()->hasTable('fragments_fts_trigram') && $long) {
                $st = $pdo->prepare('SELECT rowid AS n, bm25(fragments_fts_trigram) AS r FROM fragments_fts_trigram'
                    . ' WHERE fragments_fts_trigram MATCH ? ORDER BY r, n LIMIT ?');
                $st->execute([$match, $limit]);
                foreach ($st->fetchAll() as $row) {
                    $hits[] = [(int) $row['n'], -(float) $row['r']];
                }
            } else {
                $table = Container::quoteIdent($this->doc->tableName('fragments') ?? 'fragments');
                $text = $legacy ? '"texto"' : '"text"';
                $sum = implode(' + ', array_fill(0, count($terms), "(instr({$text}, ?) > 0)"));
                $sql = "SELECT n, ({$sum}) AS hits FROM {$table} WHERE hits > 0";
                if ($plan['phrases']) {
                    $sql .= ' AND hits = ' . count($terms);
                }
                $sql .= ' ORDER BY hits DESC, n LIMIT ?';
                $st = $pdo->prepare($sql);
                $st->execute([...$terms, $limit]);
                foreach ($st->fetchAll() as $row) {
                    $hits[] = [(int) $row['n'], (float) $row['hits']];
                }
            }
        } else {
            $fts = $legacy ? 'fragmentos_fts' : 'fragments_fts';
            $st = $pdo->prepare("SELECT rowid AS n, bm25({$fts}, 1.0, 0.5, 0.5, 1.0) AS r FROM {$fts}"
                . " WHERE {$fts} MATCH ? ORDER BY r, n LIMIT ?");
            $st->execute([$match, $limit]);
            foreach ($st->fetchAll() as $row) {
                $hits[] = [(int) $row['n'], -(float) $row['r']];
            }
        }
        $out = [];
        foreach ($hits as [$n, $score]) {
            $item = $this->fragmentItem($n, $score, ['lexical']);
            if ($item !== null) {
                $out[] = $item;
            }
        }
        return $out;
    }

    private function vectorRaw(array $query, string $space, int $limit, string $target): array
    {
        $sp = $this->doc->space($space);
        if ($sp === null) {
            throw new SpdfException('E031', "Unknown vector space: {$space}");
        }
        if (count($query) !== (int) $sp['dims']) {
            throw new SpdfException('E030', 'The query vector has ' . count($query) . " components; space {$space} has {$sp['dims']}.");
        }
        $normalized = (int) ($sp['normalized'] ?? 1) === 1;
        $q = array_map('floatval', array_values($query));
        $scored = [];
        foreach ($this->doc->vectors($space, $target) as $id => $v) {
            $scored[(string) $id] = $normalized ? Vectors::dot($q, $v) : Vectors::cosine($q, $v);
        }
        $order = $this->tieOrder($target, array_keys($scored));
        $ids = array_keys($scored);
        usort($ids, function ($a, $b) use ($scored, $order) {
            $c = $scored[$b] <=> $scored[$a];
            if ($c !== 0) {
                return $c;
            }
            return $order[$a] <=> $order[$b];
        });
        $ids = array_slice($ids, 0, max(0, $limit));
        $out = [];
        foreach ($ids as $id) {
            if ($target === 'fragment') {
                $n = $order[$id];
                if (!is_int($n) || $n === PHP_INT_MAX) {
                    continue;
                }
                $item = $this->fragmentItem($n, $scored[$id], ['vector']);
                if ($item !== null) {
                    $out[] = $item;
                }
            } else {
                $out[] = $this->otherItem($target, $id, $scored[$id]);
            }
        }
        return $out;
    }

    /** @param list<float> $vector @return list<array> */
    public function hybrid(string $query, array $vector, string $space, int $limit = 10): array
    {
        $depth = max($limit, self::HYBRID_DEPTH);
        $lists = [
            'lexical' => $this->lexicalRaw($query, $depth),
            'vector' => $this->vectorRaw($vector, $space, $depth, 'fragment'),
        ];
        $fused = [];
        foreach ($lists as $via => $list) {
            foreach ($list as $rank => $item) {
                $id = $item['fragment_id'];
                if (!isset($fused[$id])) {
                    $fused[$id] = ['item' => $item, 'score' => 0.0, 'via' => [], 'n' => $item['_n']];
                }
                $fused[$id]['score'] += 1.0 / (self::RRF_K + $rank + 1);
                $fused[$id]['via'][] = $via;
            }
        }
        $rows = array_values($fused);
        usort($rows, fn ($a, $b) => ($b['score'] <=> $a['score']) ?: ($a['n'] <=> $b['n']));
        $out = [];
        foreach (array_slice($rows, 0, max(0, $limit)) as $r) {
            $item = $r['item'];
            $item['score'] = $r['score'];
            $item['via'] = $r['via'];
            $out[] = $item;
        }
        return array_map(fn ($i) => self::public($i), $out);
    }

    /** Removes internal keys. */
    public static function public(array $item): array
    {
        unset($item['_n']);
        return $item;
    }

    private function fragmentItem(int $n, float $score, array $via): ?array
    {
        $f = $this->doc->fragmentByN($n);
        if ($f === null) {
            return null;
        }
        $anchor = is_array($f['anchor']) ? $f['anchor'] : null;
        $end = is_array($f['anchor_end'] ?? null) ? $f['anchor_end'] : null;
        return [
            'fragment_id' => $f['id'],
            'score' => $score,
            'via' => $via,
            'anchor' => $f['anchor'],
            'anchor_uri' => $anchor === null ? null : $this->doc->anchorUri($anchor, $end),
            '_n' => $n,
        ];
    }

    private function otherItem(string $target, string $id, float $score): array
    {
        $anchor = null;
        if ($target === 'unit') {
            $anchor = $this->doc->unit($id)['anchor'] ?? null;
        } elseif ($target === 'figure') {
            foreach ($this->doc->figures() as $f) {
                if ($f['id'] === $id) {
                    $anchor = $f['anchor'];
                }
            }
        }
        return [
            'target' => $target,
            'id' => $id,
            'score' => $score,
            'via' => ['vector'],
            'anchor' => $anchor,
            'anchor_uri' => is_array($anchor) ? $this->doc->anchorUri($anchor) : null,
        ];
    }

    /**
     * Tie-break keys: fragment n, unit ord, figure id.
     *
     * @param list<string> $ids
     * @return array<string,int|string>
     */
    private function tieOrder(string $target, array $ids): array
    {
        $order = [];
        if ($target === 'fragment') {
            $ns = [];
            foreach ($this->doc->rows('fragments', '', [], ['n', 'id']) as $f) {
                $ns[(string) $f['id']] = (int) $f['n'];
            }
            foreach ($ids as $id) {
                $order[$id] = $ns[$id] ?? PHP_INT_MAX;
            }
        } elseif ($target === 'unit') {
            $ords = [];
            foreach ($this->doc->units() as $u) {
                $ords[$u['id']] = (int) $u['ord'];
            }
            foreach ($ids as $id) {
                $order[$id] = $ords[$id] ?? PHP_INT_MAX;
            }
        } else {
            foreach ($ids as $id) {
                $order[$id] = $id;
            }
        }
        return $order;
    }
}
