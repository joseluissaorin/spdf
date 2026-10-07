/**
 * Búsqueda sin resultados: una lupa de mango torneado sobre una página de
 * renglones garabateados, con la esquina doblada. Dentro del cristal, el
 * renglón se queda en blanco. Nota: «ni rastro».
 */
import { type Dibujo, type Punto, tinta, lapiz, plano, nota, circulo, sombra } from '../boceto';

/** Los renglones se cortan donde empieza el cristal: dentro de la lupa no hay nada escrito. */
const LENTE: Punto = [196, 128];
const R = 50;
const renglones = [70, 92, 114, 136, 158, 180].map((y, k) => {
  const d = Math.abs(y - LENTE[1]);
  const fin = d < R ? LENTE[0] - Math.sqrt(R * R - d * d) - 6 : k === 5 ? 170 : 206;
  return tinta([[48, y], [48 + (fin - 48) * 0.35, y + (k % 2)], [48 + (fin - 48) * 0.72, y - 1], [fin, y]] as Punto[], { g: 0.8, temblor: 0.9 });
});

export const lupa: Dibujo = {
  id: 'spdf-lupa',
  ancho: 340,
  alto: 240,
  duracion: 2.4,
  titulo: { es: 'Una lupa sobre una página', en: 'A magnifying glass over a page' },
  descripcion: {
    es: 'Una página con la esquina doblada y renglones garabateados; encima, una lupa de mango torneado. Dentro del cristal no hay nada escrito. Una nota a mano dice: «ni rastro».',
    en: 'A page with a folded corner and scribbled lines; on top, a magnifying glass with a turned handle. There is nothing written inside the lens. A handwritten note says: “not a trace”.',
  },
  elementos: [
    lapiz([[30, 40], [228, 36], [232, 214], [26, 218]], { cerrado: true, g: 0.6 }),
    // La página y su esquina doblada.
    tinta([[30, 42], [196, 38]], { g: 2 }),
    tinta([[196, 38], [228, 66]], { g: 1.8 }),
    tinta([[196, 38], [198, 66], [228, 66]], { g: 1.2 }),
    tinta([[228, 66], [230, 214]], { g: 2 }),
    tinta([[230, 214], [28, 218], [30, 42]], { g: 2 }),
    sombra([[198, 42], [224, 64], [200, 64]], 45, 3.5, { cobertura: 0.7, g: 0.6 }),
    ...renglones,
    // La lupa: el aro (dos pasadas) y el mango.
    plano(circulo(LENTE, R - 3, 16), 'azul', { opacidad: 0.12 }),
    tinta(circulo(LENTE, R, 16, -20, 345), { g: 2.6, pasadas: 2 }),
    tinta([[232, 164], [246, 178]], { g: 3 }),
    tinta([[246, 178], [252, 178], [292, 218], [286, 226], [282, 226], [242, 186], [242, 180]], { g: 2.2, cerrado: true }),
    tinta([[258, 194], [264, 190]], { g: 1 }),
    tinta([[270, 206], [276, 202]], { g: 1 }),
    plano([[246, 180], [252, 178], [290, 218], [284, 224]], 'rojo', { encima: true, aguada: true, opacidad: 0.8 }),
    // Un brillo en el cristal.
    tinta([[166, 100], [176, 90], [188, 86]], { g: 1.2 }),
    nota(258, 92, ['ni rastro', 'not a trace'], { tam: 21, giro: -6 }),
    lapiz([[256, 98], [244, 108]], { g: 0.8, recto: false }),
  ],
};
