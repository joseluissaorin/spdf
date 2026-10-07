<?php

declare(strict_types=1);

namespace Spdf;

/** Raw bytes to be stored as a SQLite BLOB (vector data given already encoded, blob payloads). */
final class Blob
{
    public function __construct(public readonly string $bytes)
    {
    }
}
