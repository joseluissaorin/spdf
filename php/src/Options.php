<?php

declare(strict_types=1);

namespace Spdf;

/** Limits applied when opening untrusted files. */
final class Options
{
    public function __construct(
        /** Largest blob (blobs.data, vectors.data) accepted, in bytes. Default 512 MiB. */
        public readonly int $maxBlobBytes = 512 * 1024 * 1024,
        /** Largest size a gzip-wrapped legacy file may expand to, in bytes. Default 4 GiB. */
        public readonly int $maxInflatedBytes = 4 * 1024 * 1024 * 1024,
        /** Directory for temporary copies (gzip-wrapped or WAL files). Default: sys_get_temp_dir(). */
        public readonly ?string $tempDir = null,
    ) {
    }
}
