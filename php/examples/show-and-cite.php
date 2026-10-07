<?php

/**
 * Minimal page that shows a SPDF document, searches it and cites what it finds.
 * Any PHP host (OJS, Omeka, WordPress, a plain server) can embed the same few calls.
 *
 *   SPDF_DIR=/path/to/spdf/files php -S localhost:8080 examples/show-and-cite.php
 *   open "http://localhost:8080/?file=lazarillo.spdf&q=Tormes"
 */

declare(strict_types=1);

require __DIR__ . '/../vendor/autoload.php';

use Spdf\Document;
use Spdf\SpdfException;

$dir = realpath(getenv('SPDF_DIR') ?: __DIR__) ?: __DIR__;
$name = basename((string) ($_GET['file'] ?? ''));          // no paths: only files of $dir
$path = $dir . DIRECTORY_SEPARATOR . $name;
$q = trim((string) ($_GET['q'] ?? ''));
$locale = ($_GET['lang'] ?? 'es') === 'en' ? 'en' : 'es';
$h = fn (?string $s): string => htmlspecialchars((string) $s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');

if ($name === '' || !is_file($path)) {
    http_response_code(404);
    echo 'Unknown SPDF file.';
    return;
}

try {
    $doc = Document::open($path);                          // read-only, safe opening
} catch (SpdfException $e) {
    http_response_code(422);
    echo 'Not a valid SPDF file: ' . $h($e->getMessage());
    return;
}

if (isset($_GET['export'])) {                               // ?export=bibtex | csl
    if ($_GET['export'] === 'bibtex') {
        header('Content-Type: application/x-bibtex; charset=utf-8');
        echo $doc->bibtex();
    } else {
        header('Content-Type: application/vnd.citationstyles.csl+json; charset=utf-8');
        echo $doc->cslJson();
    }
    return;
}

$meta = $doc->metadata();
$hits = $q === '' ? [] : $doc->searchLexical($q, 10);
?>
<!doctype html>
<html lang="<?= $locale ?>">
<meta charset="utf-8">
<title><?= $h($doc->title()) ?></title>
<style>
  body { font: 17px/1.5 Georgia, serif; max-width: 46rem; margin: 2rem auto; padding: 0 1rem; color: #222; }
  blockquote { margin: 1rem 0; padding-left: 1rem; border-left: 3px solid #b5523b; }
  .cite { color: #b5523b; } small a { color: #666; }
</style>
<h1><?= $h($doc->title()) ?></h1>
<p><?= $h($doc->cite(['type' => 'image'], null, $locale)) ?> ·
   <a href="?file=<?= $h(rawurlencode($name)) ?>&amp;export=bibtex">BibTeX</a> ·
   <a href="?file=<?= $h(rawurlencode($name)) ?>&amp;export=csl">CSL-JSON</a></p>
<form>
  <input type="hidden" name="file" value="<?= $h($name) ?>">
  <input name="q" value="<?= $h($q) ?>" placeholder="<?= $locale === 'es' ? 'Buscar en el documento' : 'Search the document' ?>">
  <button><?= $locale === 'es' ? 'Buscar' : 'Search' ?></button>
</form>
<?php foreach ($hits as $hit): $f = $doc->fragment($hit['fragment_id']); ?>
  <blockquote>
    <?= $h($f['text']) ?>
    <span class="cite"><?= $h($doc->cite($hit['anchor'], is_array($f['anchor_end']) ? $f['anchor_end'] : null, $locale)) ?></span><br>
    <small><a href="<?= $h($hit['anchor_uri']) ?>"><?= $h($hit['anchor_uri']) ?></a></small>
  </blockquote>
<?php endforeach; ?>
<?php if ($q !== '' && $hits === []): ?>
  <p><?= $locale === 'es' ? 'Sin resultados.' : 'No results.' ?></p>
<?php endif; ?>
</html>
