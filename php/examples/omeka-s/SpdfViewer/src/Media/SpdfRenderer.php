<?php

namespace SpdfViewer\Media;

use Laminas\View\Renderer\PhpRenderer;
use Omeka\Api\Representation\MediaRepresentation;
use Omeka\Media\FileRenderer\RendererInterface;
use Spdf\Document;
use Spdf\SpdfException;

/** Shows a SPDF media: whole-work citation, search box and cited passages. */
class SpdfRenderer implements RendererInterface
{
    public function render(PhpRenderer $view, MediaRepresentation $media, array $options = [])
    {
        $path = OMEKA_PATH . '/files/original/' . $media->filename();
        try {
            $doc = Document::open($path);
        } catch (SpdfException $e) {
            return $view->hyperlink($media->filename(), $media->originalUrl());
        }
        $locale = str_starts_with((string) $view->lang(), 'en') ? 'en' : 'es';
        $query = trim((string) ($view->params()->fromQuery('spdf_q') ?? ''));
        $e = fn ($s) => $view->escapeHtml((string) $s);

        $html = '<div class="spdf"><p class="spdf-citation">' . $e($doc->cite(['type' => 'image'], null, $locale)) . '</p>'
            . '<form method="get"><input type="search" name="spdf_q" value="' . $e($query) . '">'
            . '<button>' . ($locale === 'es' ? 'Buscar' : 'Search') . '</button></form>';
        foreach ($query === '' ? [] : $doc->searchLexical($query, 20) as $hit) {
            $f = $doc->fragment($hit['fragment_id']);
            $end = is_array($f['anchor_end'] ?? null) ? $f['anchor_end'] : null;
            $html .= '<blockquote>' . $e($f['text']) . ' <cite>' . $e($doc->cite($hit['anchor'], $end, $locale)) . '</cite>'
                . ' <a href="' . $e($hit['anchor_uri']) . '">' . $e($hit['anchor_uri']) . '</a></blockquote>';
        }
        return $html . '</div>';
    }
}
