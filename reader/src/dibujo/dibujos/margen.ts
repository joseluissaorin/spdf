/**
 * El margen en blanco: el borde de una página con su línea de justificación,
 * un corchete vacío trazado a lápiz donde iría la nota, y un lápiz que espera
 * tumbado. Nota: «el margen espera».
 */
import { type Dibujo, tinta, lapiz, plano, nota } from '../boceto';

export const margen: Dibujo = {
  id: 'spdf-margen',
  ancho: 300,
  alto: 200,
  duracion: 2,
  titulo: { es: 'Un margen en blanco', en: 'An empty margin' },
  descripcion: {
    es: 'El borde de una página con renglones; en el margen, un corchete vacío a lápiz y un lápiz tumbado. Una nota a mano dice: «el margen espera».',
    en: 'The edge of a page with lines of text; in the margin, an empty pencil bracket and a pencil lying down. A handwritten note says: “the margin is waiting”.',
  },
  elementos: [
    lapiz([[150, 10], [152, 192]], { g: 0.6 }),
    ...[30, 52, 74, 96, 118, 140, 162].map((y, k) => tinta([[10, y], [60, y + (k % 2)], [110, y - 1], [k === 3 ? 96 : 140, y]], { g: 0.8, temblor: 0.9 })),
    // El corchete vacío.
    lapiz([[184, 48], [174, 50], [173, 118], [184, 120]], { g: 1.1, recto: false }),
    // El lápiz, tumbado.
    tinta([[176, 170], [270, 140]], { g: 1.8 }),
    tinta([[180, 182], [274, 152]], { g: 1.8 }),
    tinta([[270, 140], [274, 152]], { g: 1.6 }),
    tinta([[176, 170], [156, 182], [180, 182]], { g: 1.6 }),
    tinta([[162, 178], [158, 181]], { g: 2.4 }),
    tinta([[196, 165], [199, 176]], { g: 1 }),
    plano([[196, 164], [270, 140], [274, 152], [199, 176]], 'amarillo', { encima: true, aguada: true, opacidad: 0.85 }),
    nota(196, 92, ['el margen\nespera', 'the margin\nis waiting'], { tam: 19, giro: -5 }),
  ],
};
