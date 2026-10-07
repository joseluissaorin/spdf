/**
 * La bandeja de invitaciones: un sobre de frente, con la solapa cerrada por un
 * lacre rojo, un sello amarillo y azul matasellado en la esquina y la dirección
 * en garabatos, como se escribe deprisa. Alguien te ha llamado a su biblioteca.
 */
import { type Dibujo, tinta, lapiz, plano, disco, sombra, nota, circulo } from '../boceto';

export const sobre: Dibujo = {
  id: 'sobre',
  ancho: 340,
  alto: 220,
  duracion: 2,
  titulo: 'Un sobre lacrado',
  descripcion:
    'Un sobre dibujado a pluma, con la solapa cerrada por un lacre rojo, un sello amarillo y azul en la esquina y la dirección escrita en garabatos. En la esquina, a lápiz: «para ti».',
  elementos: [
    // Encaje: el rectángulo y las diagonales hasta la punta de la solapa.
    lapiz([[36, 36], [304, 38], [302, 200], [34, 198]], { cerrado: true }),
    lapiz([[36, 36], [170, 104]], { g: 0.6 }),
    lapiz([[304, 38], [170, 104]], { g: 0.6 }),

    // El sobre, sin cerrar del todo.
    tinta([[40, 40], [170, 38], [300, 42], [298, 196]], { g: 2.6, recto: true }),
    tinta([[298, 196], [170, 198], [40, 196], [42, 46]], { g: 2.2, recto: true }),
    tinta([[44, 202], [300, 200]], { g: 0.9, temblor: 1.1 }),
    // La solapa, que se repasó.
    tinta([[42, 42], [110, 76], [170, 104]], { g: 2, pasadas: 2 }),
    tinta([[170, 104], [236, 74], [298, 44]], { g: 2 }),
    sombra([[46, 46], [292, 46], [170, 100]], 45, 6, { cobertura: 0.45, g: 0.7 }),

    // El lacre, con su sello impreso.
    disco([170, 106], 17, 'rojo', { encima: true, aguada: true }),
    tinta([[158, 96], [168, 88], [182, 92], [188, 104], [184, 118], [170, 124], [156, 118], [152, 106], [156, 98]], { g: 1.8 }),
    tinta(circulo([170, 106], 8, 8), { g: 1, recto: false }),

    // El sello, con su borde dentado y el matasellos.
    plano([[252, 62], [288, 61], [289, 104], [253, 105]], 'amarillo', { opacidad: 0.9 }),
    plano([[260, 72], [280, 71], [281, 94], [261, 95]], 'azul', { opacidad: 0.85 }),
    tinta([[250, 60], [256, 63], [262, 59], [268, 63], [274, 59], [280, 63], [286, 59], [290, 62], [291, 106], [252, 107], [250, 60]], { g: 1.4, recto: true }),
    lapiz(circulo([248, 92], 18, 12), { recto: false }),
    tinta([[222, 86], [234, 82], [246, 86], [258, 82], [270, 86], [282, 82]], { g: 1 }),
    tinta([[224, 96], [236, 92], [248, 96], [260, 92], [272, 96]], { g: 1 }),

    // La dirección, deprisa.
    tinta([[152, 142], [160, 136], [166, 144], [174, 136], [180, 144], [192, 140], [204, 138], [212, 144], [222, 136], [232, 142], [246, 140]], { g: 1.6 }),
    tinta([[164, 160], [174, 154], [182, 162], [194, 156], [206, 160], [214, 154], [226, 162], [238, 156], [252, 160], [266, 156], [276, 160]], { g: 1.6 }),
    tinta([[176, 178], [186, 172], [196, 180], [206, 174], [218, 178], [228, 174]], { g: 1.6 }),
    tinta([[176, 186], [232, 184]], { g: 1.2, recto: true }),

    nota(52, 176, 'para ti', { tam: 22, giro: -7, tinta: 'rojo' }),
  ],
};
