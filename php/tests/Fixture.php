<?php

declare(strict_types=1);

namespace Spdf\Tests;

use Spdf\Writer;

/** Builds small SPDF files for the tests. */
final class Fixture
{
    public static function tmp(string $suffix = '.spdf'): string
    {
        $p = tempnam(sys_get_temp_dir(), 'spdftest');
        @unlink($p);
        return $p . $suffix;
    }

    public static function lazarillo(): string
    {
        $path = self::tmp();
        $w = Writer::create($path, 'spdf-php-tests/1', 'core semantic');
        $w->document([
            'id' => 'lazarillo', 'kind' => 'pdf',
            'metadata' => [
                'type' => 'book', 'title' => 'La vida de Lazarillo de Tormes: y de sus fortunas y adversidades',
                'title-short' => 'Lazarillo de Tormes', 'issued' => ['date-parts' => [[1554]]], 'language' => 'es',
            ],
            'source_sha256' => str_repeat('3f', 32), 'mime' => 'application/pdf', 'bytes' => 1000, 'unit_count' => 2,
        ]);
        $w->unit(['id' => 'u1', 'ord' => 1, 'anchor' => ['type' => 'page', 'physical' => 9, 'printed' => '3', 'source' => 'read'],
            'text' => 'Pues sepa Vuestra Merced ante todas cosas que a mí llaman Lázaro de Tormes', 'reader' => 'pdf-text-layer']);
        $w->unit(['id' => 'u2', 'ord' => 2, 'anchor' => ['type' => 'page', 'physical' => 10, 'printed' => '4', 'source' => 'inferred'],
            'text' => 'hijo de Tomé González y de Antona Pérez, naturales de Tejares, aldea de Salamanca', 'reader' => 'pdf-text-layer']);
        $w->fragment(['n' => 1, 'id' => 'f1', 'unit' => 'u1', 'ord' => 1, 'section' => ['Tratado primero'],
            'text' => 'Pues sepa Vuestra Merced ante todas cosas que a mí llaman Lázaro de Tormes',
            'anchor' => ['type' => 'page', 'physical' => 9, 'printed' => '3', 'chars' => [0, 24]]]);
        $w->fragment(['n' => 2, 'id' => 'f2', 'unit' => 'u2', 'ord' => 2,
            'text' => 'hijo de Tomé González y de Antona Pérez, naturales de Tejares, aldea de Salamanca',
            'anchor' => ['type' => 'page', 'physical' => 10, 'printed' => '4', 'source' => 'inferred'], 'search_text' => '']);
        $w->space(['id' => 'toy@3', 'provider' => 'test', 'model' => 'toy', 'dims' => 3, 'modalities' => ['text']]);
        $w->space(['id' => 'toy@3:i8', 'provider' => 'test', 'model' => 'toy', 'dims' => 3, 'dtype' => 'i8', 'modalities' => ['text']]);
        foreach (['toy@3', 'toy@3:i8'] as $s) {
            $w->vector('fragment', 'f1', $s, [1.0, 0.0, 0.0]);
            $w->vector('fragment', 'f2', $s, [0.6, 0.8, 0.0]);
        }
        $w->blob('cover', 'image/png', "\x89PNG");
        $w->provenance(['stage' => 'read', 'provider' => 'local', 'model' => 'gemma-4-e4b', 'ms' => 10, 'at' => '2026-10-07T10:00:00Z']);
        $w->finish(contentHash: true);
        return $path;
    }

    /** A gzip-wrapped legacy 4.1 file (Scholaris schema, Spanish names). */
    public static function legacy(): string
    {
        $db = self::tmp('.sqlite');
        $pdo = new \PDO('sqlite:' . $db, null, null, [\PDO::ATTR_ERRMODE => \PDO::ERRMODE_EXCEPTION]);
        $pdo->exec(<<<'SQL'
CREATE TABLE spdf (clave TEXT PRIMARY KEY, valor TEXT NOT NULL);
CREATE TABLE documentos (id TEXT PRIMARY KEY, tipo TEXT NOT NULL, metadatos TEXT NOT NULL, estado TEXT NOT NULL DEFAULT 'pendiente',
  huella TEXT NOT NULL, original TEXT NOT NULL, mime TEXT NOT NULL, bytes INTEGER NOT NULL, unidades INTEGER NOT NULL DEFAULT 0,
  duracion REAL, creado TEXT NOT NULL, actualizado TEXT NOT NULL, bibliotecas TEXT NOT NULL DEFAULT '[]', titulo TEXT, autores TEXT,
  anio INTEGER, idioma TEXT);
CREATE TABLE unidades (id TEXT PRIMARY KEY, documento TEXT NOT NULL, orden INTEGER NOT NULL, ancla TEXT NOT NULL, texto TEXT NOT NULL DEFAULT '',
  notas TEXT, cabecera TEXT, pie TEXT, imagen TEXT, miniatura TEXT, lector TEXT NOT NULL, confianza REAL NOT NULL DEFAULT 1, impresa TEXT,
  t0 REAL, t1 REAL, palabras TEXT);
CREATE TABLE secciones (id TEXT PRIMARY KEY, documento TEXT NOT NULL, padre TEXT, nivel INTEGER NOT NULL, titulo TEXT NOT NULL,
  unidad_desde TEXT NOT NULL, unidad_hasta TEXT, resumen TEXT);
CREATE TABLE fragmentos (n INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, documento TEXT NOT NULL, unidad TEXT NOT NULL, orden INTEGER NOT NULL,
  texto TEXT NOT NULL, contexto TEXT NOT NULL DEFAULT '', seccion TEXT, ancla TEXT NOT NULL, ancla_fin TEXT, texto_busqueda TEXT);
CREATE VIRTUAL TABLE fragmentos_fts USING fts5(texto, contexto, seccion, texto_busqueda, content='fragmentos', content_rowid='n',
  tokenize='unicode61 remove_diacritics 2');
CREATE TRIGGER fragmentos_ai AFTER INSERT ON fragmentos BEGIN
  INSERT INTO fragmentos_fts(rowid, texto, contexto, seccion, texto_busqueda) VALUES (new.n, new.texto, new.contexto, new.seccion, new.texto_busqueda);
END;
CREATE TABLE figuras (id TEXT PRIMARY KEY, documento TEXT NOT NULL, unidad TEXT NOT NULL, imagen TEXT NOT NULL, pie TEXT, descripcion TEXT, ancla TEXT NOT NULL);
CREATE TABLE espacios (id TEXT PRIMARY KEY, proveedor TEXT NOT NULL, modelo TEXT NOT NULL, version TEXT, dims INTEGER NOT NULL,
  normalizado INTEGER NOT NULL DEFAULT 1, modalidades TEXT NOT NULL, creado TEXT);
CREATE TABLE vectores (objetivo TEXT NOT NULL, id TEXT NOT NULL, espacio TEXT NOT NULL, documento TEXT NOT NULL, valores BLOB NOT NULL,
  PRIMARY KEY (objetivo, id, espacio));
CREATE TABLE blobs (clave TEXT PRIMARY KEY, mime TEXT NOT NULL, datos BLOB NOT NULL);
CREATE TABLE procedencia (documento TEXT NOT NULL, fase TEXT NOT NULL, proveedor TEXT, detalle TEXT, ms INTEGER, cuando TEXT NOT NULL);
INSERT INTO spdf VALUES ('spdf_version', '4.1'), ('creado', '2025-03-01T00:00:00Z'), ('generador', 'scholaris-nube/spdf 0.2');
INSERT INTO documentos (id, tipo, metadatos, huella, original, mime, bytes, unidades, creado, actualizado, titulo, autores, anio, idioma)
  VALUES ('d1', 'pdf_escaneado', '{"titulo":"Arte poética","subtitulo":"en romance castellano","autores":[{"nombre":"Miguel","apellidos":"Sánchez de Lima"}],"anio":1580,"editorial":"Manuel de Lyra","lugar":"Alcalá"}',
  'abababababababababababababababababababababababababababababababab', 'orig', 'application/pdf', 3, 2, '2025-03-01', '2025-03-01', 'Arte poética', 'Sánchez de Lima', 1580, 'es');
INSERT INTO unidades (id, documento, orden, ancla, texto, lector, impresa, imagen) VALUES
  ('ua', 'd1', 0, '{"tipo":"pagina","fisica":1,"impresa":"1","romana":false,"origen":"leido","confianza":1}', 'De la poesía castellana', 'gemini', '1', 'orig'),
  ('ub', 'd1', 1, '{"tipo":"pagina","fisica":2,"impresa":"2","romana":false,"origen":"deducido","confianza":0.5}', 'Del verso suelto', 'gemini', '2', '');
INSERT INTO fragmentos (n, id, documento, unidad, orden, texto, ancla, texto_busqueda) VALUES
  (1, 'fa', 'd1', 'ua', 0, 'De la poesía castellana', '{"tipo":"pagina","fisica":1,"impresa":"1","romana":false,"origen":"leido","confianza":1}', ''),
  (2, 'fb', 'd1', 'ub', 1, 'Del verso suelto', '{"tipo":"pagina","fisica":2,"impresa":"2","romana":false,"origen":"deducido","confianza":0.5}', '');
INSERT INTO blobs VALUES ('orig', 'application/pdf', X'255044');
SQL);
        $pdo->exec('PRAGMA user_version = 410');
        $pdo = null;
        $path = self::tmp();
        file_put_contents($path, gzencode((string) file_get_contents($db), 6));
        unlink($db);
        return $path;
    }
}
