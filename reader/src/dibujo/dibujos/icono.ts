/**
 * El icono del Lector SPDF. Tiene que leerse a 32 px, así que es el cartel y no
 * el cuaderno: una forma enorme (el disco rojo de la Bauhaus), la manícula
 * recortada en papel encima con la tinta gruesa, el puño de la manga en azurita
 * y la yema señalando un cuadrado de oro, el pasaje. La manga entra cortada por
 * el borde. Caja de 512 × 512, a sangre (iOS y Android recortan su forma).
 */
import { type Dibujo, tinta, plano, disco } from '../boceto';

const G = 13; // la tinta gruesa del cartel

export const icono: Dibujo = {
  id: 'spdf-icono',
  ancho: 512,
  alto: 512,
  duracion: 1.6,
  desregistro: [3, -2],
  titulo: { es: 'Lector SPDF', en: 'SPDF Reader' },
  descripcion: {
    es: 'Una mano con el índice extendido, recortada en papel sobre un gran disco rojo, señala un cuadrado amarillo.',
    en: 'A hand with its index finger stretched out, cut out of paper over a large red disc, points at a yellow square.',
  },
  elementos: [
    // El papel, a sangre.
    plano([[-4, -4], [516, -4], [516, 516], [-4, 516]], 'papel'),
    // El sol.
    disco([292, 222], 154, 'rojo'),
    // El pasaje, en oro.
    plano([[436, 270], [494, 266], [498, 344], [440, 348]], 'amarillo'),
    // La silueta de la mano, en papel, encima del disco.
    plano([[-4, 260], [132, 264], [166, 271], [200, 286], [400, 286], [421, 293], [429, 307], [421, 321], [400, 328], [266, 328],
      [282, 344], [284, 366], [276, 386], [280, 404], [270, 426], [236, 436], [130, 438], [-4, 442]], 'papel'),
    // El puño de la manga, en azurita.
    plano([[106, 264], [134, 266], [132, 438], [104, 440]], 'azul'),
    // La manga.
    tinta([[-6, 260], [60, 262], [134, 265]], { g: G }),
    tinta([[-6, 442], [70, 440], [132, 437]], { g: G }),
    tinta([[106, 262], [104, 350], [104, 440]], { g: G * 0.7 }),
    // El dorso y el índice.
    tinta([[134, 268], [166, 272], [200, 287]], { g: G }),
    tinta([[200, 287], [300, 287], [400, 287]], { g: G }),
    tinta([[400, 287], [421, 293], [429, 307], [421, 321], [400, 327]], { g: G }),
    tinta([[400, 327], [330, 327], [262, 327]], { g: G * 0.92 }),
    tinta([[376, 294], [396, 294], [404, 302]], { g: G * 0.45 }),
    // El pulgar.
    tinta([[250, 328], [206, 332], [192, 344], [208, 354], [258, 350]], { g: G * 0.85 }),
    // Los dedos doblados (dos nudillos) y la palma.
    tinta([[258, 350], [280, 360], [278, 382], [258, 388]], { g: G * 0.85 }),
    tinta([[258, 388], [276, 400], [268, 424], [236, 434]], { g: G * 0.85 }),
    tinta([[226, 434], [180, 436], [134, 437]], { g: G }),
  ],
};
