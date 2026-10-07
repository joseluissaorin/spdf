<?php

declare(strict_types=1);

namespace Spdf\Tests;

use PHPUnit\Framework\TestCase;
use Spdf\Conformance\Runner;

/** Runs the shared conformance suite of the repository, when it is present. */
final class ConformanceTest extends TestCase
{
    public function testSuite(): void
    {
        $dir = __DIR__ . '/../../conformance';
        if (glob($dir . '/cases/*.json') === []) {
            $this->markTestSkipped('No conformance cases in ' . $dir);
        }
        $report = (new Runner($dir))->run();
        $this->assertSame([], $report['failed'], json_encode($report['failed'], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
    }
}
