/**
 * La lámina de bienvenida: un libro abierto, encajado a lápiz, recortado sobre
 * su propio papel como un collage pegado encima del disco rojo de la pantalla.
 * En el margen de la página derecha, una manícula señala un renglón subrayado
 * en oro; abajo, el folio impreso, rodeado en minio por un lector anterior.
 * La inicial de la página izquierda es un cuadrado azul de la Bauhaus y la
 * cinta del registro, roja, cuelga del lomo. Nota a mano: «léelo una vez;
 * cítalo siempre».
 */
import { type Dibujo, type Punto, tinta, lapiz, rojo, plano, sombra, nota, circulo } from '../boceto';
import { manoEn } from './manicula';

/** Un renglón garabateado: tinta fina que ondula un poco. */
const renglon = (x0: number, x1: number, y: number, k: number): ReturnType<typeof tinta> =>
  tinta([[x0, y + (k % 2 ? 0.5 : -0.5)], [x0 + (x1 - x0) * 0.33, y + (k % 3) * 0.6 - 0.4], [x0 + (x1 - x0) * 0.7, y - (k % 2) * 0.8], [x1, y + 0.4]] as Punto[], { g: 0.85, temblor: 0.9 });

const izq: ReturnType<typeof tinta>[] = [];
const der: ReturnType<typeof tinta>[] = [];
for (let k = 0; k < 9; k++) {
  const y = 140 + k * 23;
  izq.push(renglon(k < 2 ? 120 : 90, k === 4 || k === 8 ? 196 : 254, y, k));
  der.push(renglon(306, k === 3 ? 400 : k === 8 ? 372 : 446, y - 2, k + 3));
}

export const bienvenida: Dibujo = {
  id: 'spdf-bienvenida',
  ancho: 560,
  alto: 420,
  duracion: 3.4,
  desregistro: [1.1, -0.8],
  titulo: { es: 'Un libro abierto con una manícula en el margen', en: 'An open book with a manicule in the margin' },
  descripcion: {
    es: 'Un libro abierto dibujado a pluma sobre un trozo de papel. La página izquierda empieza con una inicial azul; en el margen de la derecha, una mano con el índice extendido señala un renglón subrayado en amarillo. Abajo, el número de página, 145, está rodeado con un círculo rojo, y del lomo cuelga una cinta roja. Una nota a mano dice: «léelo una vez; cítalo siempre».',
    en: 'An open book drawn in pen on a piece of paper. The left page starts with a blue initial; in the margin of the right page, a hand with its index finger stretched out points at a line underlined in yellow. At the bottom, the page number, 145, is circled in red, and a red ribbon hangs from the spine. A handwritten note says: “read it once; cite it forever”.',
  },
  elementos: [
    // El papel propio de la lámina: un recorte pegado, un poco torcido.
    plano([[20, 28], [546, 12], [554, 404], [12, 412]], 'papel'),

    // Encaje a lápiz: la mesa, el eje del lomo y la caja de cada página.
    lapiz([[14, 386], [552, 380]]),
    lapiz([[283, 26], [285, 400]]),
    lapiz([[66, 120], [278, 100], [282, 362], [60, 370]], { cerrado: true, g: 0.6 }),
    lapiz([[288, 100], [500, 112], [508, 372], [286, 362]], { cerrado: true, g: 0.6 }),

    // La cinta del registro, que cuelga del lomo (detrás de las páginas).
    plano([[288, 100], [295, 99], [298, 402], [293.5, 393], [289, 403]], 'rojo'),

    // Las páginas: la izquierda…
    tinta([[64, 118], [120, 109], [200, 101], [258, 98], [281, 105]], { g: 2.4 }),
    tinta([[64, 118], [61, 240], [58, 366]], { g: 2.4 }),
    tinta([[58, 366], [150, 358], [240, 354], [282, 361]], { g: 2.4 }),
    // …y la derecha.
    tinta([[283, 105], [304, 96], [384, 98], [460, 104], [501, 112]], { g: 2.4 }),
    // El canto exterior, interrumpido donde entra la mano.
    tinta([[501, 112], [502, 160], [503, 212]], { g: 2.4 }),
    tinta([[504, 254], [506, 310], [508, 370]], { g: 2.4 }),
    tinta([[282, 361], [330, 354], [420, 358], [508, 370]], { g: 2.4 }),
    // El lomo, que pesa: dos pasadas.
    tinta([[282, 104], [283, 232], [282, 361]], { g: 1.6, pasadas: 2 }),
    // El canto de las hojas, debajo.
    tinta([[60, 373], [160, 365], [282, 369]], { g: 1 }),
    tinta([[282, 369], [400, 366], [507, 378]], { g: 1 }),
    tinta([[62, 379], [180, 371], [282, 375]], { g: 0.7 }),
    // La sombra del pliegue, a medias, a cada lado del lomo.
    sombra([[256, 104], [281, 106], [281, 358], [254, 356]], 70, 5, { cobertura: 0.55, g: 0.7 }),
    sombra([[284, 106], [302, 100], [304, 356], [284, 358]], 112, 5, { cobertura: 0.45, g: 0.6 }),

    // La inicial azul (un cuadrado de la Bauhaus) y los renglones.
    plano([[88, 129], [113, 128], [114, 155], [89, 156]], 'azul'),
    ...izq,
    ...der,

    // El renglón señalado, subrayado en oro por encima de la tinta.
    plano([[302, 222], [450, 219], [452, 235], [300, 238]], 'amarillo', { encima: true, aguada: true, opacidad: 0.75 }),

    // El folio impreso y el círculo de minio de un lector anterior.
    nota(394, 346, '145', { tam: 15, tinta: 'tinta', ancla: 'middle' }),
    rojo(circulo([393, 341], 19, 14, -100, 255, 15), { g: 1.5 }),

    // La manícula, en el margen derecho, con la yema junto al renglón.
    ...manoEn(452, 197, 0.66),

    // La nota al margen.
    nota(66, 56, ['léelo una vez;\ncítalo siempre', 'read it once;\ncite it forever'], { tam: 23, giro: -3, tinta: 'lapiz' }),
    lapiz([[214, 80], [238, 92], [252, 108]], { g: 0.8, recto: false }),
  ],
};
