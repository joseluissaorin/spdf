/**
 * Fusión de los resultados de varios documentos en una sola lista para la
 * búsqueda en toda la biblioteca. Las puntuaciones de documentos distintos no
 * son comparables (bm25 depende de cada índice), así que se funden por rango
 * con RRF (k = 10, el mismo que la búsqueda híbrida del contrato): el mejor de
 * cada documento queda arriba y los demás se intercalan por su posición.
 * Desempata la puntuación propia y, después, el orden de la biblioteca.
 */
import type { Acierto } from '../nucleo/tipos';

export function fusionarBiblioteca(listas: Acierto[][], limite: number, k = 10): Acierto[] {
  const todos: { a: Acierto; s: number; d: number }[] = [];
  listas.forEach((l, d) => l.forEach((a, i) => todos.push({ a, s: 1 / (k + i + 1), d })));
  todos.sort((x, y) => y.s - x.s || y.a.score - x.a.score || x.d - y.d || x.a.n - y.a.n);
  return todos.slice(0, limite).map((t) => t.a);
}
