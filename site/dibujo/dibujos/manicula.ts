/**
 * La manícula: la manita con el índice extendido que los lectores dibujaban en
 * los márgenes para decir «mira aquí». Es el emblema de Scholaris: señalar, no
 * contestar. Dibujada a mano, punto a punto, de izquierda (la manga, que entra
 * por el borde) a derecha (la yema del dedo).
 */
import { type Dibujo, tinta, lapiz, sombra, nota, plano, disco, circulo } from '../boceto';

export const manicula: Dibujo = {
  id: 'manicula',
  ancho: 640,
  alto: 300,
  duracion: 3.6,
  titulo: { es: 'Una manícula dibujada a pluma', en: 'A manicule drawn in pen' },
  descripcion: {
    es: 'Una mano con el índice extendido, como las que los lectores antiguos dibujaban en el margen de los libros, sale de una manga con puños de encaje y señala hacia la derecha. Debajo se adivinan las líneas de lápiz con que se encajó el dibujo y, al lado, una nota a mano: «señala; no contesta».',
    en: 'A hand with its index finger stretched out, like the ones old readers drew in the margins of their books, comes out of a sleeve with a lace cuff and points to the right. Underneath, the pencil lines that set out the drawing are still visible and, beside it, a handwritten note: “it points; it doesn\'t answer”.',
  },
  elementos: [
    // Encaje a lápiz: el eje del dedo, la caja de la manga, el círculo del puño.
    lapiz([[0, 98], [636, 101]]),
    lapiz([[248, 76], [430, 78], [440, 122], [252, 120]], { cerrado: true, g: 0.7 }),
    lapiz([[560, 84], [564, 118]]),
    nota(566, 90, 'p. 145', { tam: 15, tinta: 'rojo' }),
    lapiz([[8, 58], [118, 52], [124, 214], [10, 210]], { cerrado: true }),
    lapiz(circulo([236, 150], 58, 14), { recto: false }),
    lapiz([[200, 64], [212, 214]]),

    // La manga, que entra por el borde.
    tinta([[-8, 70], [40, 66], [86, 60], [112, 58]], { g: 2.6 }),
    tinta([[-8, 200], [44, 204], [92, 208], [114, 210]], { g: 2.6 }),
    tinta([[-6, 92], [60, 88], [104, 84]], { g: 1.2 }),
    // El puño de encaje: un festón que baja ondulando.
    tinta([[112, 50], [124, 62], [114, 74], [127, 88], [116, 102], [129, 116], [118, 130], [130, 144], [119, 158], [131, 172], [120, 186], [132, 200], [118, 216]], { g: 2.2 }),
    tinta([[106, 54], [108, 120], [110, 214]], { g: 1.6, pasadas: 2 }),

    // El dorso de la mano, desde la muñeca hasta el nudillo.
    tinta([[130, 68], [160, 58], [196, 60], [224, 72], [246, 80]], { g: 2.8 }),
    // El índice: arriba, la yema, abajo.
    tinta([[246, 80], [300, 80], [360, 81], [404, 82]], { g: 2.8 }),
    tinta([[404, 82], [424, 86], [434, 99], [426, 112], [404, 117]], { g: 3 }),
    tinta([[404, 117], [350, 117], [296, 116], [262, 115]], { g: 2.5 }),
    // Arrepentimiento: la yema primero salió más larga.
    tinta([[414, 82], [438, 92], [440, 108], [420, 118]], { g: 1, temblor: 1.1 }),
    // La uña, abierta.
    tinta([[394, 86], [410, 86], [420, 94], [418, 101], [404, 102]], { g: 1.3 }),
    // Pliegues de las falanges.
    tinta([[300, 86], [303, 99], [300, 111]], { g: 1.3 }),
    tinta([[307, 88], [309, 100]], { g: 0.9 }),
    tinta([[356, 88], [358, 101]], { g: 1 }),

    // El pulgar, recogido sobre los otros dedos.
    tinta([[236, 118], [282, 120], [318, 124], [334, 132], [326, 142], [300, 144], [256, 142]], { g: 2.4 }),
    tinta([[316, 124], [328, 128], [330, 136]], { g: 1.1 }),
    // Los tres dedos doblados.
    tinta([[250, 144], [272, 150], [278, 162], [266, 170], [238, 170]], { g: 2.4 }),
    tinta([[244, 172], [262, 178], [266, 190], [254, 196], [230, 196]], { g: 2.4 }),
    tinta([[234, 198], [248, 204], [248, 214], [236, 218], [214, 214]], { g: 2.2 }),
    // La palma, de la muñeca al meñique.
    tinta([[132, 204], [170, 214], [214, 214]], { g: 2.6 }),

    // Sombra de la manga, a medias.
    sombra([[0, 94], [104, 86], [108, 206], [0, 202]], 62, 7, { cobertura: 0.62, g: 0.9 }),
    // Sombra bajo los dedos, apenas empezada.
    sombra([[214, 150], [262, 168], [250, 214], [212, 214]], -30, 6, { cobertura: 0.5, g: 0.8 }),

    // El toque de minio: el puño de la manga.
    plano([[106, 56], [114, 52], [120, 214], [110, 216]], 'rojo', { encima: true, aguada: true, opacidad: 0.85 }),

    nota(470, 160, ['señala;\nno contesta', 'it points;\nit doesn\'t answer'], { tam: 22, giro: -4, tinta: 'lapiz' }),
    lapiz([[468, 146], [442, 120]], { g: 0.8, recto: false }),
  ],
};

/** La manecilla del margen: la misma mano, sin lápiz ni notas, encuadrada en el puño y el dedo. */
export const manecilla: Dibujo = {
  ...manicula,
  id: 'manecilla',
  duracion: 1.6,
  caja: [70, 44, 380, 184],
  elementos: manicula.elementos.filter((e) => e.tipo !== 'nota' && !(e.tipo === 'trazo' && e.tinta === 'lapiz')),
};

/** El sol rojo de la portada: un círculo plano, recortado a mano. */
export const sol: Dibujo = {
  id: 'sol',
  ancho: 400,
  alto: 400,
  duracion: 0.8,
  titulo: { es: 'Un círculo rojo', en: 'A red circle' },
  descripcion: { es: 'Un gran círculo rojo plano, a la manera de la Bauhaus.', en: 'A large flat red circle, in the manner of the Bauhaus.' },
  elementos: [disco([200, 200], 196, 'rojo')],
};
