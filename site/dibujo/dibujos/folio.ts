/**
 * La lámina de la portada de SPDF: el recto de un libro, con su folio impreso
 * («21») marcado a lápiz rojo, renglones garabateados, la esquina de abajo
 * doblada y, en el margen, una manícula que entra por el borde y señala un
 * pasaje subrayado con una aguada de oro. Es la idea entera del formato: el
 * pasaje se cita con el folio que lleva impreso (21), no con el número de la
 * hoja en el fichero (29), y la mano señala exactamente ahí.
 *
 * La mano es la manícula de Scholaris, reducida y llevada al margen.
 */
import { type Dibujo, type Elemento, type Punto, tinta, lapiz, rojo, plano, sombra, nota, circulo } from '../boceto';
import { manicula } from './manicula';

/** Lleva un elemento a otra escala y otro sitio; la pluma adelgaza un poco menos que el dibujo. */
function llevar(e: Elemento, dx: number, dy: number, s: number): Elemento {
  const m = (p: readonly Punto[]) => p.map(([x, y]) => [x * s + dx, y * s + dy] as Punto);
  if (e.tipo === 'trazo') return { ...e, p: m(e.p), g: e.g * Math.sqrt(s) };
  if (e.tipo === 'plano') return { ...e, p: e.p ? m(e.p) : undefined };
  if (e.tipo === 'sombra') return { ...e, zona: m(e.zona), paso: Math.max(3.4, e.paso * s), g: e.g * 0.9 };
  return { ...e, x: e.x * s + dx, y: e.y * s + dy, tam: e.tam * s };
}

/** La mano sin su lápiz ni sus notas: la yema del índice cae en (256, 268). */
const S = 0.7;
const mano = manicula.elementos
  .filter((e) => e.tipo !== 'nota' && !(e.tipo === 'trazo' && e.tinta === 'lapiz'))
  .map((e) => llevar(e, 256 - 434 * S, 268 - 99 * S, S));

/** Un renglón garabateado de x0 a x1 a la altura y; `ola` lo hace subir y bajar distinto en cada uno. */
function renglon(y: number, x0: number, x1: number, ola: number): Elemento {
  const p: Punto[] = [];
  const n = Math.max(3, Math.round((x1 - x0) / 34));
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n;
    p.push([x, y + (i % 2 ? -1.6 : 1.4) * (1 + ((i * ola) % 3) * 0.25)]);
  }
  return tinta(p, { g: 1.15, temblor: 0.5 });
}

// Los renglones: [y, desde, hasta]. Un aparte después del sexto; el pasaje citado va del 7.º al 9.º.
const RENGLONES: [number, number, number][] = [
  [116, 284, 652], [138, 284, 652], [160, 284, 650], [182, 284, 652], [204, 284, 588],
  [226, 304, 652], [248, 284, 652], [270, 284, 650], [292, 284, 652], [314, 284, 522],
  [336, 304, 652], [358, 284, 652], [380, 284, 650], [402, 284, 610],
];

export const folio: Dibujo = {
  id: 'spdf-folio',
  ancho: 880,
  alto: 540,
  duracion: 3.8,
  desregistro: [1.1, -0.8],
  titulo: { es: 'Una página con su folio y una manícula que señala un pasaje', en: 'A page with its folio and a manicule pointing at a passage' },
  descripcion: {
    es: 'El recto de un libro dibujado a pluma: renglones garabateados, la esquina de abajo doblada y, arriba a la derecha, el folio impreso «21» rodeado con lápiz rojo. Al margen, una nota a mano dice «impresa 21, física 29». Una manícula entra por el borde izquierdo y señala con el índice tres renglones subrayados con una aguada de oro. Debajo de la mano, otra nota: «aquí, y solo aquí».',
    en: 'The recto of a book drawn in pen: scribbled lines of text, the bottom corner folded and, top right, the printed folio “21” circled in red pencil. In the margin, a handwritten note reads “printed 21, physical 29”. A manicule comes in from the left edge and points its index finger at three lines washed in gold. Under the hand, another note: “here, and only here”.',
  },
  elementos: [
    // Encaje a lápiz: la caja del texto, la línea de la cabecera, el eje de la mano al pasaje.
    lapiz([[278, 100], [660, 98], [662, 412], [279, 414]], { cerrado: true, g: 0.6 }),
    lapiz([[278, 74], [662, 72]], { g: 0.6 }),
    lapiz([[0, 268], [272, 269]], { g: 0.7 }),
    lapiz([[630, 40], [632, 112]], { g: 0.6 }),

    // La hoja: el canto de arriba, el de fuera, la esquina doblada y el de abajo.
    tinta([[236, 44], [420, 40], [560, 42], [706, 44]], { g: 2.6 }),
    tinta([[706, 44], [708, 200], [706, 360], [704, 468]], { g: 2.6 }),
    tinta([[704, 468], [688, 478], [678, 512]], { g: 2 }),
    tinta([[704, 468], [700, 492], [678, 512]], { g: 1.4, temblor: 1 }),
    tinta([[678, 512], [520, 516], [360, 514], [234, 518]], { g: 2.6 }),
    tinta([[234, 518], [232, 300], [236, 44]], { g: 2.2, pasadas: 2 }),
    // El grueso del libro: las hojas de debajo asoman por fuera y por abajo.
    tinta([[714, 54], [716, 240], [713, 470]], { g: 1.1 }),
    tinta([[686, 522], [470, 524], [244, 526]], { g: 1 }),
    sombra([[688, 478], [702, 470], [700, 492], [680, 510]], 35, 4, { cobertura: 0.6, g: 0.7 }),

    // La cabecera: un título corrido, pequeño, y el folio a la derecha.
    tinta([[392, 74], [430, 72], [470, 75], [512, 72], [548, 74]], { g: 1 }),
    nota(648, 82, '21', { tam: 26, ancla: 'middle', tinta: 'tinta' }),

    // Los renglones.
    ...RENGLONES.map(([y, a, b], i) => renglon(y, a, b, i + 1)),

    // Notas al pie: un filete corto y dos renglones finos.
    tinta([[284, 436], [372, 435]], { g: 0.9, recto: true }),
    tinta([[284, 456], [330, 454], [380, 457], [430, 455], [476, 456]], { g: 0.8 }),
    tinta([[284, 474], [334, 472], [372, 474]], { g: 0.8 }),

    // El pasaje, con una aguada de oro que no llena el borde.
    plano([[340, 238], [660, 237], [661, 281], [524, 282], [523, 303], [276, 302], [275, 259], [340, 259]], 'amarillo', { encima: true, aguada: true, opacidad: 0.62 }),

    // La mano entra por el borde y señala.
    ...mano,

    // Lo que marca quien lee: el folio rodeado y una raya roja al margen del pasaje.
    rojo(circulo([650, 72], 24, 12, 210, 575), { g: 1.3, temblor: 1 }),
    rojo([[266, 240], [263, 270], [266, 300]], { g: 1.8 }),

    // Las notas al margen.
    nota(742, 70, ['impresa 21,\nfísica 29', 'printed 21,\nphysical 29'], { tam: 21, giro: -3, tinta: 'rojo' }),
    lapiz([[738, 66], [678, 70]], { g: 0.8, recto: false }),
    nota(26, 432, ['aquí, y solo aquí', 'here, and only here'], { tam: 22, giro: -4 }),
    lapiz([[96, 408], [140, 364]], { g: 0.8, recto: false }),
  ],
};
