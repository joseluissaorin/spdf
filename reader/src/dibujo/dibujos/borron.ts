/**
 * El error: una pluma de ave caída en diagonal y, en su punta, el borrón que
 * se ha extendido por el papel, con tres gotas que saltaron. Debajo, los
 * renglones a lápiz de la página. Nota: «se ha corrido la tinta».
 */
import { type Dibujo, type Punto, tinta, lapiz, plano, disco, nota, sombra } from '../boceto';

/** Una mancha de tinta: radios escritos a mano (no al azar), con dos lenguas que se escapan. */
function mancha(c: Punto, r: number): Punto[] {
  const radios = [1, 0.92, 1.1, 0.86, 0.95, 1.32, 1.05, 0.9, 1, 0.84, 0.98, 1.08, 0.9, 1.25, 1.02, 0.88, 0.96, 1.12, 0.94, 0.9, 1.04, 0.86, 1, 0.95];
  const out: Punto[] = [];
  radios.forEach((k, i) => {
    const a = (i / radios.length) * Math.PI * 2;
    out.push([c[0] + Math.cos(a) * r * k * 1.15, c[1] + Math.sin(a) * r * k * 0.78]);
    if (i % 2) {
      // Entre cada dos radios, un punto a medio camino para que el borde ondule.
      const b = ((i + 0.5) / radios.length) * Math.PI * 2;
      out.push([c[0] + Math.cos(b) * r * (k + 0.06) * 1.12, c[1] + Math.sin(b) * r * (k + 0.06) * 0.76]);
    }
  });
  return out;
}

export const borron: Dibujo = {
  id: 'spdf-borron',
  ancho: 340,
  alto: 240,
  duracion: 2.4,
  titulo: { es: 'Un borrón de tinta', en: 'An ink blot' },
  descripcion: {
    es: 'Una pluma de ave caída sobre una página con renglones a lápiz; de su punta se ha extendido un borrón de tinta con tres gotas. Una nota a mano dice: «se ha corrido la tinta».',
    en: 'A quill pen lying on a page ruled in pencil; an ink blot with three drops has spread from its nib. A handwritten note says: “the ink ran”.',
  },
  elementos: [
    // Los renglones de la página.
    lapiz([[14, 150], [326, 146]], { g: 0.6 }),
    lapiz([[14, 178], [326, 175]], { g: 0.6 }),
    lapiz([[14, 206], [326, 204]], { g: 0.6 }),
    lapiz([[40, 20], [42, 230]], { g: 0.5 }),

    // El borrón: una mancha que no es un círculo, con sus gotas.
    plano(mancha([52, 198], 28), 'tinta', { opacidad: 0.92 }),
    disco([104, 184], 4.5, 'tinta'),
    disco([116, 198], 3, 'tinta'),
    disco([98, 214], 2.2, 'tinta'),

    // La pluma: el cañón…
    tinta([[70, 186], [120, 146], [180, 102], [238, 62], [292, 26]], { g: 2 }),
    tinta([[70, 186], [60, 198], [56, 204]], { g: 2.6 }),
    tinta([[60, 192], [74, 182]], { g: 1 }),
    // …y el ala de barbas, a un lado del cañón.
    tinta([[132, 140], [150, 112], [182, 86], [222, 60], [262, 40], [300, 22]], { g: 2.2 }),
    tinta([[300, 22], [290, 40], [268, 58], [236, 80], [200, 104], [164, 128], [138, 142]], { g: 1.6 }),
    tinta([[154, 120], [168, 116]], { g: 0.9 }),
    tinta([[176, 98], [194, 94]], { g: 0.9 }),
    tinta([[204, 78], [224, 74]], { g: 0.9 }),
    tinta([[234, 60], [252, 55]], { g: 0.9 }),
    tinta([[262, 44], [278, 40]], { g: 0.9 }),
    // Una barba suelta, despeinada.
    tinta([[214, 90], [226, 96], [232, 104]], { g: 0.8, temblor: 1.2 }),
    sombra([[150, 116], [216, 70], [232, 80], [168, 126]], 20, 5, { cobertura: 0.5, g: 0.7 }),
    // El toque de minio: el cañón teñido junto a la punta.
    plano([[74, 178], [92, 166], [96, 172], [78, 184]], 'rojo', { encima: true, aguada: true, opacidad: 0.8 }),

    nota(176, 168, ['se ha corrido\nla tinta', 'the ink\nran'], { tam: 20, giro: -4 }),
  ],
};
