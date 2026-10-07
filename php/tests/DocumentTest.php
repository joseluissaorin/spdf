<?php

declare(strict_types=1);

namespace Spdf\Tests;

use PHPUnit\Framework\TestCase;
use Spdf\AnchorUri;
use Spdf\Document;
use Spdf\Json;
use Spdf\Options;
use Spdf\SpdfException;
use Spdf\Validator;
use Spdf\Vectors;

final class DocumentTest extends TestCase
{
    private static string $file;
    private static string $legacy;

    public static function setUpBeforeClass(): void
    {
        self::$file = Fixture::lazarillo();
        self::$legacy = Fixture::legacy();
    }

    public static function tearDownAfterClass(): void
    {
        @unlink(self::$file);
        @unlink(self::$legacy);
    }

    public function testOpensAndReads(): void
    {
        $d = Document::open(self::$file);
        $this->assertSame('5.0', $d->version());
        $this->assertFalse($d->isLegacy());
        $this->assertSame('La vida de Lazarillo de Tormes: y de sus fortunas y adversidades', $d->title());
        $this->assertCount(2, $d->units());
        $this->assertSame('sha256-' . str_repeat('3f', 32), $d->docref());
        $this->assertSame("\x89PNG", $d->blob('blob:cover'));
    }

    public function testValidatesWithContentHash(): void
    {
        $r = Validator::validate(self::$file);
        $this->assertTrue($r['valid'], json_encode($r));
        $this->assertSame([], $r['warnings']);
    }

    public function testDumpIsCanonical(): void
    {
        $d = Document::open(self::$file);
        $json = $d->dumpJson();
        $this->assertStringStartsWith('{"blobs":[{"bytes":4,"key":"cover"', $json);
        $this->assertSame($json, Json::canonical(Json::decode($json)));
        $this->assertSame(Document::open(self::$file)->meta()['content_sha256'], $d->contentSha256());
    }

    public function testLexicalSearchFoldsDiacriticsThroughTheIndex(): void
    {
        $d = Document::open(self::$file);
        $hits = $d->searchLexical('lazaro', 5);
        $this->assertSame('f1', $hits[0]['fragment_id']);
        $this->assertSame(['lexical'], $hits[0]['via']);
        $this->assertSame('spdf:sha256-' . str_repeat('3f', 32) . '#p=9&f=3&char=0,24', $hits[0]['anchor_uri']);
        $this->assertSame(['f2'], array_column($d->searchLexical('"Antona Pérez" Tormes'), 'fragment_id'));
        $this->assertSame([], $d->searchLexical('   '));
    }

    public function testVectorAndHybridSearch(): void
    {
        $d = Document::open(self::$file);
        $v = $d->searchVector([0.6, 0.8, 0.0], 'toy@3:i8', 2);
        $this->assertSame(['f2', 'f1'], array_column($v, 'fragment_id'));
        $h = $d->searchHybrid('Salamanca', [1.0, 0.0, 0.0], 'toy@3', 2);
        $this->assertSame('f2', $h[0]['fragment_id']);
        $this->assertSame(['lexical', 'vector'], $h[0]['via']);
        $this->assertEqualsWithDelta(1 / 11 + 1 / 12, $h[0]['score'], 1e-12);
        $this->expectException(SpdfException::class);
        $d->searchVector([1.0], 'toy@3');
    }

    public function testCitations(): void
    {
        $d = Document::open(self::$file);
        $this->assertSame('(Lazarillo de Tormes, 1554, p. 3)', $d->citeFragment('f1', 'es'));
        $this->assertSame('(Lazarillo de Tormes, 1554, p. [4])', $d->citeFragment('f2', 'en'));
        $this->assertSame('(Lazarillo de Tormes, 1554, pp. 3-[4])',
            $d->cite(['type' => 'page', 'physical' => 9, 'printed' => '3'], ['type' => 'page', 'physical' => 10, 'printed' => '4', 'source' => 'inferred']));
    }

    public function testExports(): void
    {
        $d = Document::open(self::$file);
        $csl = Json::decode($d->cslJson());
        $this->assertSame('la1554', $csl[0]['id']);
        $this->assertArrayNotHasKey('spdf', $csl[0]);
        $this->assertStringStartsWith("@book{la1554,\n  title = {{La} vida de {Lazarillo} de {Tormes:}", $d->bibtex());
    }

    public function testLegacyView(): void
    {
        $d = Document::open(self::$legacy);
        $this->assertTrue($d->isLegacy());
        $this->assertSame('4.1', $d->version());
        $dump = $d->dump();
        $this->assertTrue($dump['legacy']);
        $this->assertSame('scanned_pdf', $dump['document']['kind']);
        $this->assertSame('blob:orig', $dump['document']['source_ref']);
        $this->assertSame('Arte poética: en romance castellano', $dump['document']['metadata']['title']);
        $this->assertSame([['family' => 'Sánchez de Lima', 'given' => 'Miguel']], $dump['document']['metadata']['author']);
        $this->assertSame([1, 2], array_column($dump['units'], 'ord'));
        $this->assertSame('inferred', $dump['units'][1]['anchor']['source']);
        $this->assertNull($dump['units'][1]['image']);
        $this->assertSame('2025-03-01T00:00:00Z', $dump['meta']['created']);
        $this->assertSame(['fa'], array_column($d->searchLexical('poesia'), 'fragment_id'));
        $this->assertSame('(Sánchez de Lima, 1580, p. [2])', $d->citeFragment('fb'));
        $r = Validator::validate(self::$legacy);
        $this->assertTrue($r['valid']);
        $this->assertSame(['W110'], array_column($r['warnings'], 'code'));
    }

    public function testRejectsTriggersAndViews(): void
    {
        $copy = Fixture::tmp();
        copy(self::$file, $copy);
        $pdo = new \PDO('sqlite:' . $copy);
        $pdo->exec('CREATE VIEW v AS SELECT 1');
        $pdo = null;
        try {
            Document::open($copy);
            $this->fail('A view must be refused.');
        } catch (SpdfException $e) {
            $this->assertSame('E020', $e->spdfCode);
        } finally {
            @unlink($copy);
        }
    }

    public function testRefusesBlobsAboveTheLimit(): void
    {
        $this->expectException(SpdfException::class);
        Document::open(self::$file, new Options(maxBlobBytes: 2));
    }

    public function testBoundsGzipInflation(): void
    {
        $this->expectException(SpdfException::class);
        Document::open(self::$legacy, new Options(maxInflatedBytes: 1024));
    }

    public function testNotSqlite(): void
    {
        $p = Fixture::tmp();
        file_put_contents($p, str_repeat('not sqlite ', 20));
        $r = Validator::validate($p);
        unlink($p);
        $this->assertSame(['E001'], array_column($r['errors'], 'code'));
    }

    public function testAnchorUriRoundTrip(): void
    {
        $uri = AnchorUri::fromAnchor('doc 1', ['type' => 'section', 'path' => ['Cap. 3', 'a/b'], 'paragraph' => 4,
            'region' => ['x' => 0.125, 'y' => 0, 'w' => 0.5, 'h' => 1]]);
        $this->assertSame('spdf:doc%201#s=Cap.%203/a%2Fb&para=4&xywh=percent:12.5,0,50,100', $uri);
        $p = AnchorUri::parse($uri);
        $this->assertSame(['Cap. 3', 'a/b'], $p['locator']['s']);
        $this->assertSame($uri, AnchorUri::format($p['docref'], $p['locator']));
        $this->assertSame([3723.5, 3800], AnchorUri::parse('spdf:x#t=npt:1:02:03.5,3800')['locator']['t']);
    }

    public function testCanonicalNumbers(): void
    {
        $this->assertSame('[1,0.97,0.000001,0,1e+21,0.123457]', Json::canonical([1.0, 0.97, 0.000001, -0.0, 1e21, 0.1234567]));
        $this->assertSame('{"a":{},"b":[],"é":"\u001f"}', Json::canonical(['é' => "\x1f", 'b' => [], 'a' => new \stdClass()]));
    }

    public function testHalfFloats(): void
    {
        foreach ([0.0, 1.0, -2.5, 0.333251953125, 65504.0, 6.103515625e-5] as $f) {
            $this->assertSame($f, Vectors::decode(Vectors::encode([$f], 'f16'), 'f16')[0]);
        }
        $this->assertSame([76, 102, -127], array_values(unpack('c*', Vectors::encode([0.6, 0.8, -2.0], 'i8'))));
    }
}
