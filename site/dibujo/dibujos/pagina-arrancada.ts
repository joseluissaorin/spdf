/**
 * El error 404: un libro abierto donde alguien arrancó una hoja. Junto al lomo
 * queda el talón dentado; la página de la izquierda es la 145, y en la de la
 * derecha el folio dice 146, tachado, porque ahí ya va la 148.
 */
import { type Dibujo, tinta, lapiz, sombra, nota } from '../boceto';

export const paginaArrancada: Dibujo = {
  id: 'pagina-arrancada',
  ancho: 360,
  alto: 240,
  duracion: 2.2,
  titulo: 'Un libro abierto con una hoja arrancada',
  descripcion:
    'Un libro abierto, visto un poco desde arriba; junto al lomo queda el talón dentado de una hoja arrancada. La página de la izquierda lleva el folio «p. 145» y la de la derecha un folio tachado y corregido en rojo. Arriba, a lápiz: «aquí faltaba una hoja».',
  elementos: [
    // Encaje: el lomo y la caja del libro.
    lapiz([[180, 40], [181, 222]], { g: 0.6 }),
    lapiz([[22, 64], [338, 64], [340, 204], [20, 204]], { cerrado: true, g: 0.6 }),

    // La página de la izquierda.
    tinta([[28, 66], [70, 52], [130, 50], [178, 64]], { g: 2.4 }),
    tinta([[28, 66], [22, 200]], { g: 2.2 }),
    tinta([[22, 200], [70, 190], [130, 190], [178, 206]], { g: 2.4 }),
    tinta([[20, 204], [70, 195], [130, 196], [178, 212]], { g: 1 }),
    // La de la derecha.
    tinta([[182, 64], [230, 50], [290, 52], [332, 66]], { g: 2.4 }),
    tinta([[332, 66], [338, 200]], { g: 2.2 }),
    tinta([[182, 206], [230, 190], [290, 190], [338, 200]], { g: 2.4 }),
    tinta([[182, 212], [230, 196], [290, 196], [340, 205]], { g: 1 }),
    // El lomo, repasado.
    tinta([[180, 62], [180, 136], [181, 210]], { g: 2, pasadas: 2 }),

    // Los renglones, que se cansan hacia abajo.
    sombra([[44, 84], [164, 80], [164, 176], [44, 180]], 0, 12, { cobertura: 0.75, g: 1.1 }),
    sombra([[218, 82], [318, 84], [320, 180], [218, 176]], 0, 12, { cobertura: 0.75, g: 1.1 }),

    // El talón de la hoja arrancada, dentado, y su sombra.
    tinta([[184, 62], [194, 72], [190, 84], [202, 96], [194, 108], [204, 122], [195, 134], [206, 148], [197, 162], [205, 176], [196, 190], [202, 206]], { g: 2.2 }),
    tinta([[186, 70], [192, 78]], { g: 0.8 }),
    sombra([[182, 66], [192, 74], [194, 110], [196, 160], [198, 204], [182, 206]], 70, 3, { cobertura: 0.7, g: 0.8 }),
    // Arrepentimiento: el primer talón salió demasiado ancho.
    tinta([[210, 92], [214, 120], [210, 150]], { g: 0.8, temblor: 1.2 }),

    // Los folios.
    nota(40, 76, 'p. 145', { tam: 14, tinta: 'tinta' }),
    nota(318, 78, 'p. 146', { tam: 14, tinta: 'tinta', ancla: 'end' }),
    tinta([[280, 72], [320, 70]], { g: 1.4, recto: true }),
    nota(318, 96, '148', { tam: 15, tinta: 'rojo', ancla: 'end', giro: -6 }),

    nota(196, 30, 'aquí faltaba una hoja', { tam: 18, giro: -3, tinta: 'lapiz', ancla: 'middle' }),
    lapiz([[196, 36], [194, 62]], { g: 0.8, recto: false }),
  ],
};
