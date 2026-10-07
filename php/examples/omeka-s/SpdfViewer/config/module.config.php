<?php

namespace SpdfViewer;

return [
    'file_renderers' => [
        'invokables' => ['spdf' => Media\SpdfRenderer::class],
        // Omeka picks the renderer by media type or by extension.
        'aliases' => ['application/vnd.spdf' => 'spdf', 'spdf' => 'spdf'],
    ],
];
