/**
 * Colecciones como manifiesto `.spdfl.json` (contrato §9):
 * {"spdf_library":"1.0","name":…,"items":[{"sha256","title","authors","year","url"?}]}
 * `sha256` es la huella del original (documents.source_sha256), la misma que usan
 * las anclas: no cambia si el SPDF se revectoriza.
 */
import type { Coleccion, EntradaBiblioteca } from '../nucleo/nucleo';

export function manifiestoColeccion(c: Coleccion, entradas: EntradaBiblioteca[]): string {
  const items = c.items.map((sha) => {
    const e = entradas.find((x) => x.source_sha256 === sha);
    return { sha256: sha, title: e?.titulo ?? '', authors: e?.autores ?? '', year: e?.anio ?? null, ...(e ? { file_sha256: e.id } : {}) };
  });
  return JSON.stringify({ spdf_library: '1.0', name: c.nombre, created: new Date().toISOString().replace(/\.\d+Z$/, 'Z'), items }, null, 2) + '\n';
}

export function leerManifiesto(json: string): Coleccion {
  const m = JSON.parse(json) as { spdf_library?: string; name?: string; items?: { sha256?: string }[] };
  if (!m.spdf_library || !Array.isArray(m.items)) throw new Error('No es un manifiesto .spdfl.json');
  const items = m.items.map((i) => String(i.sha256 ?? '').toLowerCase()).filter((s) => /^[0-9a-f]{64}$/.test(s));
  return { id: crypto.randomUUID().slice(0, 8), nombre: m.name || 'Colección', items };
}
