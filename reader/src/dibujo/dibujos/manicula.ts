/**
 * La manícula del Lector SPDF: una mano con el índice extendido, como las que
 * los lectores dibujaban en el margen para decir «mira aquí». Esta señala hacia
 * la izquierda, hacia el texto, desde el margen derecho de la página: es la que
 * se mete en la lámina de bienvenida. La manga entra por la derecha con un puño
 * de encaje; tres dedos doblados, el pulgar recogido, la uña abierta.
 *
 * Dibujada punto a punto en una caja de 240 × 124 (la yema en x≈6, la manga
 * cortada por el borde derecho). `manoEn()` la recoloca donde haga falta y
 * `emblema` es la misma mano, mirando a la derecha, para la cabecera.
 */
import { type Dibujo, type Elemento, type Punto, tinta, lapiz, sombra, plano } from '../boceto';

/** Refleja y recoloca una lista de puntos (espejo horizontal en una caja de ancho `w`). */
export const espejo = (p: readonly Punto[], w: number): Punto[] => p.map(([x, y]) => [w - x, y] as Punto);
const mv = (p: readonly Punto[], dx: number, dy: number, s: number, flip: boolean): Punto[] =>
  (flip ? espejo(p, 240) : p).map(([x, y]) => [x * s + dx, y * s + dy] as Punto);

/** Los trazos de la mano (sin lápiz), en su caja de 240 × 124. */
function trazosMano(): { p: Punto[]; g: number; o?: Partial<{ pasadas: number; temblor: number }> }[] {
  return [
    // La manga, que entra por el borde derecho.
    { p: [[246, 20], [214, 22], [190, 26], [178, 28]], g: 2.6 },
    { p: [[246, 104], [216, 102], [192, 98], [180, 96]], g: 2.6 },
    { p: [[244, 44], [214, 44], [192, 46]], g: 1.1 },
    // El puño de encaje: un festón que baja ondulando.
    { p: [[181, 18], [171, 26], [180, 35], [170, 44], [179, 53], [169, 62], [178, 71], [168, 80], [177, 89], [168, 97], [178, 106]], g: 2 },
    { p: [[186, 22], [185, 60], [187, 100]], g: 1.4, o: { pasadas: 2 } },
    // El dorso, de la muñeca al nudillo.
    { p: [[166, 32], [148, 26], [128, 27], [110, 33]], g: 2.8 },
    // El índice: arriba, la yema, abajo.
    { p: [[110, 33], [80, 33], [44, 34], [20, 35]], g: 2.8 },
    { p: [[20, 35], [9, 39], [5, 46], [10, 53], [21, 55]], g: 3 },
    { p: [[21, 55], [52, 55], [84, 55], [104, 56]], g: 2.5 },
    // Arrepentimiento: la yema primero salió más corta.
    { p: [[14, 36], [4, 43], [4, 50], [12, 55]], g: 1, o: { temblor: 1.1 } },
    // La uña, abierta.
    { p: [[30, 37], [18, 38], [13, 43], [17, 47], [29, 47]], g: 1.2 },
    // Pliegues de las falanges.
    { p: [[60, 38], [58, 46], [60, 52]], g: 1.2 },
    { p: [[54, 40], [53, 48]], g: 0.8 },
    { p: [[88, 38], [87, 49]], g: 0.9 },
    // El pulgar, recogido.
    { p: [[118, 58], [100, 59], [88, 62], [83, 68], [89, 74], [106, 74], [122, 72]], g: 2.4 },
    { p: [[93, 63], [87, 66], [87, 70]], g: 1 },
    // Los tres dedos doblados.
    { p: [[122, 75], [104, 78], [96, 85], [102, 92], [128, 91]], g: 2.3 },
    { p: [[130, 92], [112, 95], [106, 102], [112, 108], [138, 107]], g: 2.3 },
    { p: [[140, 108], [126, 110], [124, 116], [132, 120], [152, 117]], g: 2.1 },
    // La palma, del meñique a la muñeca.
    { p: [[152, 117], [166, 108], [176, 98]], g: 2.5 },
  ];
}

/** La mano entera colocada en (dx, dy) con escala s; `flip` la hace mirar a la derecha. */
export function manoEn(dx: number, dy: number, s = 1, flip = false, conSombra = true): Elemento[] {
  const el: Elemento[] = trazosMano().map((t) => tinta(mv(t.p, dx, dy, s, flip), { g: t.g * Math.max(0.7, s), ...(t.o ?? {}) }));
  if (conSombra) {
    // Sombra de la manga, a medias.
    el.push(sombra(mv([[190, 48], [244, 46], [244, 100], [192, 96]], dx, dy, s, flip), 58, 6 * s, { cobertura: 0.58, g: 0.8 }));
    // Bajo los dedos doblados, apenas empezada.
    el.push(sombra(mv([[106, 96], [140, 100], [150, 116], [124, 118]], dx, dy, s, flip), -28, 5 * s, { cobertura: 0.5, g: 0.7 }));
  }
  // El toque de minio: el puño de la manga, como un iluminador que pasa por encima.
  el.push(plano(mv([[172, 22], [186, 20], [188, 104], [174, 104]], dx, dy, s, flip), 'rojo', { encima: true, aguada: true, opacidad: 0.85 }));
  return el;
}

/** Para la mesa de dibujo y las pruebas: la mano sola, con su encaje a lápiz. */
export const manicula: Dibujo = {
  id: 'spdf-manicula',
  ancho: 250,
  alto: 130,
  duracion: 2.2,
  titulo: { es: 'Una manícula dibujada a pluma', en: 'A manicule drawn in pen' },
  descripcion: {
    es: 'Una mano con el índice extendido hacia la izquierda, como las que se dibujaban en el margen de los libros, sale de una manga con puño de encaje rojo.',
    en: 'A hand with its index finger stretched to the left, like those drawn in the margins of books, comes out of a sleeve with a red lace cuff.',
  },
  elementos: [
    lapiz([[0, 45], [250, 46]]),
    lapiz([[100, 24], [172, 24], [176, 122], [96, 122]], { cerrado: true, g: 0.6 }),
    ...manoEn(0, 0),
  ],
};

/** El emblema de la cabecera: la misma mano mirando a la derecha, sin lápiz ni sombras. */
export const emblema: Dibujo = {
  id: 'spdf-emblema',
  ancho: 250,
  alto: 130,
  caja: [-2, 14, 252, 112],
  duracion: 1.2,
  titulo: { es: 'Lector SPDF', en: 'SPDF Reader' },
  descripcion: { es: 'Una manícula que señala a la derecha.', en: 'A manicule pointing right.' },
  elementos: manoEn(0, 0, 1, true, false),
};
