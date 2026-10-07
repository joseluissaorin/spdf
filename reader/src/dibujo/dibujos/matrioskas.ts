/**
 * El recorte Matryoshka: tres muñecas, cada una dentro de la anterior, con sus
 * cifras debajo (768, 256, 128). La grande, en minio; la mediana, en azurita;
 * la pequeña, en oro: los tres colores de la Bauhaus. Los vectores recortados
 * caben dentro de los enteros.
 */
import { type Dibujo, type Elemento, type Punto, tinta, lapiz, plano, nota, circulo, disco } from '../boceto';

/** Una muñeca con la base en (cx, base) y altura h. */
function muneca(cx: number, base: number, h: number, color: 'rojo' | 'azul' | 'amarillo'): Elemento[] {
  const s = h / 120;
  const P = (pts: [number, number][]): Punto[] => pts.map(([x, y]) => [cx + x * s, base - y * s] as Punto);
  return [
    // El cuerpo: una pera que se cierra abajo.
    plano(P([[-38, 4], [-44, 30], [-36, 62], [-24, 76], [24, 76], [36, 62], [44, 30], [38, 4]]), color, { aguada: true, opacidad: 0.85 }),
    tinta(P([[-24, 78], [-38, 62], [-45, 32], [-40, 6], [-30, 0], [30, 0], [40, 6], [45, 32], [38, 62], [24, 78]]), { g: 2.2 * Math.max(0.75, s) }),
    // La cabeza (el pañuelo) y, dentro, el óvalo de la cara.
    tinta(circulo([cx, base - 96 * s], 22 * s, 12, 0, 360), { g: 2 * Math.max(0.75, s) }),
    tinta(circulo([cx, base - 94 * s], 12 * s, 10, 0, 360, 13 * s), { g: 1 * Math.max(0.7, s) }),
    // Los ojos y la boca.
    disco([cx - 4.5 * s, base - 97 * s], 1.7 * s, 'tinta'),
    disco([cx + 4.5 * s, base - 97 * s], 1.7 * s, 'tinta'),
    plano(P([[-3, 89], [3, 89], [0, 87]]), 'rojo'),
    // El delantal y su flor.
    tinta(P([[-20, 66], [-24, 36], [-18, 10], [18, 10], [24, 36], [20, 66]]), { g: 1 * Math.max(0.7, s) }),
    tinta(circulo([cx, base - 40 * s], 8 * s, 8, 0, 360), { g: 1 * Math.max(0.7, s) }),
  ];
}

export const matrioskas: Dibujo = {
  id: 'spdf-matrioskas',
  ancho: 300,
  alto: 220,
  duracion: 2.6,
  titulo: { es: 'Tres matrioskas: 768, 256 y 128', en: 'Three matryoshka dolls: 768, 256 and 128' },
  descripcion: {
    es: 'Tres muñecas rusas de tamaño decreciente, una roja, una azul y una amarilla, con las cifras 768, 256 y 128 escritas a mano debajo.',
    en: 'Three Russian dolls of decreasing size, one red, one blue and one yellow, with the numbers 768, 256 and 128 handwritten below.',
  },
  elementos: [
    lapiz([[8, 178], [292, 176]]),
    ...muneca(78, 176, 150, 'rojo'),
    ...muneca(178, 176, 100, 'azul'),
    ...muneca(250, 176, 66, 'amarillo'),
    nota(78, 206, '768', { tam: 18, ancla: 'middle', tinta: 'rojo' }),
    nota(178, 206, '256', { tam: 18, ancla: 'middle' }),
    nota(250, 206, '128', { tam: 18, ancla: 'middle' }),
  ],
};
