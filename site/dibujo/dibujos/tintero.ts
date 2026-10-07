/**
 * Escribir vacío: un tintero bajo y ancho, de los de escritorio, con una pluma
 * de ave metida dentro. Una gota se ha escapado y ha hecho charco en la mesa;
 * la página, de momento, sigue en blanco.
 */
import { type Dibujo, tinta, lapiz, plano, sombra, nota } from '../boceto';

export const tintero: Dibujo = {
  id: 'tintero',
  ancho: 340,
  alto: 240,
  duracion: 2,
  titulo: 'Un tintero con una pluma de ave',
  descripcion:
    'Un tintero bajo y ancho dibujado a pluma, con una pluma de ave metida en el cuello. Junto a él cae una gota y hay un pequeño charco de tinta azul. Al margen, a mano: «empieza por una frase».',
  elementos: [
    // Encaje: la mesa, el eje, la elipse de la base.
    lapiz([[8, 204], [334, 201]]),
    lapiz([[150, 100], [151, 214]], { g: 0.6 }),
    lapiz([[70, 192], [96, 182], [150, 178], [204, 182], [230, 192]], { recto: false, g: 0.6 }),

    // El cuerpo, ancho y bajo.
    tinta([[130, 136], [108, 139], [86, 148], [74, 160], [70, 176], [74, 192]], { g: 2.6 }),
    tinta([[170, 136], [192, 139], [214, 148], [226, 160], [230, 176], [226, 192]], { g: 2.6 }),
    tinta([[74, 192], [100, 202], [150, 206], [200, 202], [226, 192]], { g: 2.6, pasadas: 2 }),
    tinta([[82, 152], [116, 161], [150, 163], [184, 161], [218, 151]], { g: 1.4 }),
    // El cuello y el labio.
    tinta([[132, 154], [130, 132], [128, 120]], { g: 2.2 }),
    tinta([[168, 154], [170, 132], [172, 120]], { g: 2.2 }),
    tinta([[125, 116], [132, 110], [150, 108], [168, 110], [175, 116], [168, 122], [150, 124], [132, 122], [125, 116]], { g: 2 }),
    sombra([[132, 116], [140, 112], [158, 112], [168, 116], [160, 120], [140, 120]], 15, 2.2, { g: 1 }),
    sombra([[196, 152], [218, 152], [228, 172], [226, 190], [204, 200], [198, 178]], 70, 5, { cobertura: 0.6, g: 0.9 }),
    sombra([[30, 210], [72, 196], [120, 206], [70, 216]], 20, 5, { cobertura: 0.45, g: 0.7 }),

    // La pluma: el cañón, y un primer cañón que salió torcido.
    tinta([[150, 116], [194, 86], [240, 55], [298, 15]], { g: 2, recto: true }),
    tinta([[156, 114], [200, 84]], { g: 0.9, recto: true, temblor: 1 }),
    // Las barbas, por arriba y por abajo, abiertas.
    tinta([[194, 84], [202, 62], [213, 52], [224, 40], [238, 34], [250, 25], [264, 22], [275, 17], [298, 13]], { g: 1.8 }),
    tinta([[202, 79], [214, 74], [228, 73], [240, 64], [255, 59], [266, 48], [278, 39], [290, 26], [298, 15]], { g: 1.6 }),
    tinta([[219, 68], [208, 55]], { g: 1 }),
    tinta([[231, 60], [220, 45]], { g: 1 }),
    tinta([[244, 51], [235, 35]], { g: 1 }),
    tinta([[257, 42], [249, 27]], { g: 1 }),
    tinta([[270, 34], [264, 22]], { g: 1 }),
    tinta([[226, 63], [230, 72]], { g: 1 }),
    tinta([[240, 54], [246, 64]], { g: 1 }),
    tinta([[254, 45], [258, 56]], { g: 1 }),
    // La pelusa del arranque.
    tinta([[190, 88], [184, 80], [188, 76]], { g: 1 }),

    // La gota, que cae, y el charco.
    tinta([[252, 150], [256, 162], [256, 168], [252, 172], [247, 168], [248, 160], [252, 150]], { g: 1.6 }),
    plano([[252, 154], [255, 164], [252, 170], [249, 165]], 'azul', { encima: true, opacidad: 0.85 }),
    plano([[232, 200], [246, 194], [262, 196], [274, 202], [262, 209], [240, 210], [228, 206]], 'azul', { aguada: true, opacidad: 0.75 }),
    tinta([[230, 204], [246, 195], [264, 197], [275, 203], [262, 210]], { g: 1.2 }),

    nota(16, 46, 'empieza por\nuna frase', { tam: 20, giro: -4 }),
    lapiz([[60, 80], [88, 108], [118, 118]], { recto: false, g: 0.8 }),
  ],
};
