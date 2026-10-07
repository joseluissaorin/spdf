/**
 * El azar de la mano, con semilla. Un dibujo de la portada tiene que temblar
 * siempre igual: en cada recarga, en el prerenderizado y en las pruebas. Por eso
 * nada aquí toca Math.random; todo sale de una semilla que se deriva del nombre
 * del dibujo y del número de trazo.
 */

/** FNV-1a de 32 bits: convierte un nombre («manicula/indice») en una semilla estable. */
export function semillaDe(texto: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Mulberry32: pequeño, rápido y suficiente para que una línea tiemble con criterio. */
export function generador(semilla: number): () => number {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Un número entre a y b. */
export function entre(azar: () => number, a: number, b: number): number {
  return a + (b - a) * azar();
}
