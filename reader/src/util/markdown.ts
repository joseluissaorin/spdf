/**
 * Exportar a Markdown: la referencia del documento y, debajo, cada subrayado
 * como cita literal con su cita corta (y su enlace de ancla), y las notas del
 * usuario. Sirve para pegar en Obsidian, Zettlr, Pandoc o un correo.
 */
import type { Anotacion } from './anotaciones';

export function aMarkdown(o: { titulo: string; autores: string; anio: number | null; referencia: string; anotaciones: Anotacion[]; lengua: 'es' | 'en' }): string {
  const es = o.lengua === 'es';
  const l: string[] = [];
  l.push(`# ${o.titulo}`, '');
  if (o.autores || o.anio) l.push(`*${[o.autores, o.anio ?? (es ? 's. f.' : 'n.d.')].filter(Boolean).join(', ')}*`, '');
  const ordenadas = [...o.anotaciones].sort((a, b) => a.ord - b.ord || a.desde - b.desde);
  if (ordenadas.length) {
    l.push(`## ${es ? 'Subrayados y notas' : 'Highlights and notes'}`, '');
    for (const a of ordenadas) {
      l.push(`> «${a.exacto.replace(/\s+/g, ' ').trim()}» ${a.cita}`);
      if (a.uri) l.push(`> <${a.uri}>`);
      l.push('');
      if (a.nota) l.push(a.nota.trim(), '');
    }
  }
  l.push(`## ${es ? 'Referencia' : 'Reference'}`, '', o.referencia.trim(), '');
  return l.join('\n');
}
