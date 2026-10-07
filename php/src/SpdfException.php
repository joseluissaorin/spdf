<?php

declare(strict_types=1);

namespace Spdf;

/**
 * Any failure while opening, reading or writing a SPDF file.
 *
 * `spdfCode` carries the validation code of the SPDF contract (§12) when there is
 * one: E001 not SQLite, E002 unknown version, E020 trigger or view, E060 unknown
 * required extension, and so on.
 */
final class SpdfException extends \RuntimeException
{
    public function __construct(
        public readonly string $spdfCode,
        string $message,
        ?\Throwable $previous = null,
    ) {
        parent::__construct("[{$spdfCode}] {$message}", 0, $previous);
    }
}
