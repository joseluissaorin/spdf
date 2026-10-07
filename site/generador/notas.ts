/**
 * Las viñetas vienen de Scholaris con las notas a lápiz en castellano; en las
 * hojas inglesas se traducen.
 */
import type { Dibujo } from '../dibujo/boceto';

/** Las notas a lápiz de las viñetas de Scholaris están en castellano; en inglés se traducen. */
const NOTAS_EN: Record<string, string> = {
  'aquí': 'here', 'aquí irán\ntus libros': 'your books\nwill go here', 'se lee…': 'reading…', 'guárdala bien': 'keep it safe',
  'suéltalo\naquí': 'drop it\nhere', '¿con cuál?': 'which one?', 'aquí faltaba una hoja': 'a leaf was missing here',
  'el centro,\nquieto': 'the centre,\nstill', '12°, a ojo': '12°, by eye', '¡ojo!': 'look!', 'a escuadra': 'square',
  'mide dos\nveces': 'measure\ntwice', 'para ti': 'for you', 'nada por\naquí…': 'nothing\nhere…', 'todavía': 'yet',
  'empieza por\nuna frase': 'start with\na sentence',
};

export function bilingue(d0: Dibujo): Dibujo {
  return {
    ...d0,
    elementos: d0.elementos.map((e) => (e.tipo === 'nota' && typeof e.texto === 'string' && NOTAS_EN[e.texto] ? { ...e, texto: { es: e.texto, en: NOTAS_EN[e.texto]! } } : e)),
  };
}

