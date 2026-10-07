<?php

/**
 * Omeka S module (sketch). Install in modules/SpdfViewer, run
 * `composer require joseluissaorin/spdf` inside it, and allow the .spdf extension
 * and the application/vnd.spdf media type in Settings > Security.
 */

namespace SpdfViewer;

use Omeka\Module\AbstractModule;

require_once __DIR__ . '/vendor/autoload.php';

class Module extends AbstractModule
{
    public function getConfig()
    {
        return include __DIR__ . '/config/module.config.php';
    }
}
