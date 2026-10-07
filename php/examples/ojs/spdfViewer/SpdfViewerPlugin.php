<?php

/**
 * OJS 3.4 generic plugin (sketch): shows a SPDF galley as a readable, searchable,
 * citable page instead of a download link.
 *
 * Install: copy this folder to plugins/generic/spdfViewer, run
 * `composer require joseluissaorin/spdf` inside it, enable it in
 * Settings > Website > Plugins, and upload the .spdf file as a galley.
 */

namespace APP\plugins\generic\spdfViewer;

use APP\template\TemplateManager;
use PKP\config\Config;
use PKP\plugins\GenericPlugin;
use PKP\plugins\Hook;
use Spdf\Document;
use Spdf\SpdfException;

require_once __DIR__ . '/vendor/autoload.php';

class SpdfViewerPlugin extends GenericPlugin
{
    public function register($category, $path, $mainContextId = null)
    {
        $success = parent::register($category, $path, $mainContextId);
        if ($success && $this->getEnabled($mainContextId)) {
            // Called when a reader opens a galley: [$request, $issue, $galley, $submission, $publication]
            Hook::add('ArticleHandler::view::galley', [$this, 'viewGalley']);
        }
        return $success;
    }

    public function getDisplayName()
    {
        return __('plugins.generic.spdfViewer.name');
    }

    public function getDescription()
    {
        return __('plugins.generic.spdfViewer.description');
    }

    public function viewGalley(string $hookName, array $args): bool
    {
        [$request, $issue, $galley] = $args;
        $file = $galley->getFile();
        if (!$file || !str_ends_with(strtolower((string) $file->getLocalizedData('name')), '.spdf')) {
            return Hook::CONTINUE; // not ours: OJS shows the galley as usual
        }
        $path = rtrim(Config::getVar('files', 'files_dir'), '/') . '/' . $file->getData('path');
        try {
            $doc = Document::open($path); // read-only, rejects triggers and views
        } catch (SpdfException $e) {
            return Hook::CONTINUE;
        }

        $locale = str_starts_with((string) $request->getUserVar('lang') ?: 'es', 'en') ? 'en' : 'es';
        $query = trim((string) $request->getUserVar('q'));
        $hits = [];
        foreach ($query === '' ? [] : $doc->searchLexical($query, 20) as $hit) {
            $fragment = $doc->fragment($hit['fragment_id']);
            $end = is_array($fragment['anchor_end'] ?? null) ? $fragment['anchor_end'] : null;
            $hits[] = [
                'text' => $fragment['text'],
                'citation' => $doc->cite($hit['anchor'], $end, $locale), // (Author, Year, p. 45)
                'uri' => $hit['anchor_uri'],                              // spdf:sha256-…#p=…
            ];
        }

        $templateMgr = TemplateManager::getManager($request);
        $templateMgr->assign([
            'spdfTitle' => $doc->title(),
            'spdfCitation' => $doc->cite(['type' => 'image'], null, $locale),
            'spdfBibtex' => $doc->bibtex(),
            'spdfQuery' => $query,
            'spdfHits' => $hits,
        ]);
        $templateMgr->display($this->getTemplateResource('spdf.tpl'));
        return Hook::ABORT; // the galley is rendered
    }
}
