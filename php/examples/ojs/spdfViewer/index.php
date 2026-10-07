<?php

// OJS 3.3 entry point; OJS 3.4 also loads the namespaced class directly.
require_once __DIR__ . '/SpdfViewerPlugin.php';

return new \APP\plugins\generic\spdfViewer\SpdfViewerPlugin();
