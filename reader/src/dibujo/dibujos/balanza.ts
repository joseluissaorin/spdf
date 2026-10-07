/**
 * El juez: una balanza de dos platos. En uno, un papelito enrollado (la
 * afirmación); en el otro, un libro abierto (el pasaje). El fiel, un triángulo
 * rojo. Nota: «pesa cada afirmación».
 */
import { type Dibujo, tinta, lapiz, plano, nota, circulo, disco } from '../boceto';

export const balanza: Dibujo = {
  id: 'spdf-balanza',
  ancho: 300,
  alto: 240,
  duracion: 2.6,
  titulo: { es: 'Una balanza de dos platos', en: 'A two-pan balance' },
  descripcion: {
    es: 'Una balanza: en el plato izquierdo, un papel enrollado; en el derecho, un libro abierto. En el centro, un triángulo rojo. Una nota a mano dice: «pesa cada afirmación».',
    en: 'A balance: on the left pan, a rolled paper; on the right, an open book. In the middle, a red triangle. A handwritten note says: “weighs every claim”.',
  },
  elementos: [
    lapiz([[150, 20], [150, 222]], { g: 0.6 }),
    lapiz([[20, 222], [280, 222]]),
    // El pie y la columna.
    tinta([[112, 220], [150, 206], [188, 220]], { g: 2.4 }),
    tinta([[110, 222], [190, 222]], { g: 2.6, pasadas: 2 }),
    tinta([[148, 206], [148, 60]], { g: 2.2 }),
    tinta([[153, 206], [153, 60]], { g: 1.4 }),
    // El fiel: un triángulo rojo.
    plano([[140, 64], [161, 64], [150.5, 40]], 'rojo'),
    disco([150.5, 58], 3.5, 'tinta'),
    // La cruz, apenas inclinada.
    tinta([[46, 66], [100, 62], [150, 58], [204, 54], [256, 50]], { g: 2.6 }),
    // Los hilos y los platos.
    tinta([[48, 66], [30, 140]], { g: 0.9 }),
    tinta([[48, 66], [68, 140]], { g: 0.9 }),
    tinta([[254, 50], [234, 128]], { g: 0.9 }),
    tinta([[254, 50], [274, 128]], { g: 0.9 }),
    tinta(circulo([49, 142], 26, 10, 0, 180, 8), { g: 2.2 }),
    tinta([[23, 142], [75, 142]], { g: 1.2 }),
    tinta(circulo([254, 130], 26, 10, 0, 180, 8), { g: 2.2 }),
    tinta([[228, 130], [280, 130]], { g: 1.2 }),
    // La afirmación: un papelito enrollado.
    tinta([[34, 140], [36, 124], [62, 120], [64, 136]], { g: 1.4 }),
    tinta(circulo([60, 128], 5, 8, 0, 360), { g: 1.2 }),
    tinta([[40, 128], [54, 126]], { g: 0.7 }),
    // El pasaje: un libro abierto.
    tinta([[236, 128], [240, 114], [254, 110], [254, 126]], { g: 1.4 }),
    tinta([[254, 110], [268, 112], [272, 126]], { g: 1.4 }),
    tinta([[243, 118], [251, 116]], { g: 0.7 }),
    tinta([[257, 116], [266, 117]], { g: 0.7 }),
    plano([[228, 132], [280, 132], [270, 140], [238, 140]], 'azul', { encima: true, aguada: true, opacidad: 0.7 }),
    plano([[23, 144], [75, 144], [66, 152], [32, 152]], 'amarillo', { encima: true, aguada: true, opacidad: 0.8 }),
    nota(168, 168, ['pesa cada\nafirmación', 'weighs\nevery claim'], { tam: 18, giro: -4 }),
  ],
};
