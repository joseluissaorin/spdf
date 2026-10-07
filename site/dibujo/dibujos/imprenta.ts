/**
 * La prensa de mano de Gutenberg, pequeña, como se la dibuja en un margen: dos
 * montantes, el travesaño, el husillo con su barra, la platina que baja y el
 * carro del que asoma una hoja recién tirada. Acompaña la lectura de un archivo.
 */
import { type Dibujo, tinta, lapiz, rojo, plano, sombra, nota } from '../boceto';

export const imprenta: Dibujo = {
  id: 'imprenta',
  ancho: 300,
  alto: 220,
  duracion: 2,
  titulo: 'Una prensa de mano',
  descripcion:
    'Una prensa de imprenta antigua dibujada a pluma: dos montantes unidos por un travesaño, el husillo en el centro con su barra, la platina y el carro, del que sale una hoja con una inicial roja. Al lado, a lápiz: «se lee…».',
  elementos: [
    // Encaje: el suelo, el eje del husillo, la altura del carro.
    lapiz([[8, 204], [292, 202]]),
    lapiz([[146, 6], [147, 208]], { g: 0.6 }),
    lapiz([[26, 124], [282, 121]], { g: 0.6 }),

    // Los montantes, con los pies.
    tinta([[96, 18], [95, 110], [94, 200]], { g: 2.6 }),
    tinta([[110, 20], [109, 200]], { g: 1.8 }),
    tinta([[184, 20], [185, 110], [186, 200]], { g: 1.8 }),
    tinta([[198, 18], [200, 200]], { g: 2.6 }),
    tinta([[78, 200], [122, 201]], { g: 2.4, recto: true }),
    tinta([[172, 201], [218, 199]], { g: 2.4, recto: true }),
    // El travesaño, con su cornisa; el de abajo, que sostiene el carro.
    tinta([[80, 12], [146, 9], [214, 12]], { g: 2.8, pasadas: 2 }),
    tinta([[86, 20], [86, 40], [208, 40], [210, 20]], { g: 2, recto: true }),
    tinta([[110, 158], [184, 157]], { g: 1.6, recto: true }),
    // La madera de los montantes, sombreada a medias.
    sombra([[96, 40], [109, 40], [109, 196], [95, 196]], 70, 5, { cobertura: 0.6, g: 0.8 }),
    sombra([[185, 40], [199, 40], [200, 196], [186, 196]], 70, 5, { cobertura: 0.6, g: 0.8 }),
    sombra([[88, 30], [208, 30], [208, 39], [88, 39]], 60, 5, { cobertura: 0.5, g: 0.7 }),

    // El husillo, con la rosca a medio hacer.
    tinta([[140, 40], [141, 94]], { g: 1.6 }),
    tinta([[152, 40], [151, 94]], { g: 1.6 }),
    tinta([[140, 50], [152, 46], [140, 58], [152, 54], [140, 66], [152, 62], [141, 74]], { g: 1.1, recto: true }),
    // La barra, que se empuja; la primera salió demasiado tiesa.
    tinta([[148, 82], [190, 72], [236, 58]], { g: 2.4 }),
    tinta([[150, 88], [196, 82], [238, 74]], { g: 0.9, temblor: 1.2 }),
    tinta([[236, 52], [244, 54], [246, 62], [238, 66], [232, 60], [234, 54]], { g: 2 }),

    // La platina, que baja sobre el carro.
    tinta([[116, 96], [176, 95], [177, 110], [117, 111]], { g: 2.4, cerrado: true, recto: true }),
    sombra([[118, 104], [176, 103], [176, 110], [118, 111]], 0, 2.5, { cobertura: 0.7, g: 0.8 }),

    // El carro, que sale por los dos lados.
    tinta([[28, 120], [146, 118], [268, 119]], { g: 2.4 }),
    tinta([[30, 134], [146, 133], [266, 132]], { g: 2 }),
    tinta([[28, 120], [30, 134]], { g: 1.6 }),
    sombra([[30, 128], [268, 126], [266, 133], [30, 134]], 0, 3, { cobertura: 0.5, g: 0.7 }),

    // La hoja recién tirada, que cuelga por el extremo.
    tinta([[212, 118], [258, 114], [280, 120], [290, 140], [288, 168]], { g: 1.8 }),
    tinta([[288, 168], [268, 170], [270, 146], [262, 132]], { g: 1.6 }),
    tinta([[274, 150], [284, 149]], { g: 0.9 }),
    tinta([[274, 158], [284, 157]], { g: 0.9 }),
    plano([[272, 134], [282, 133], [283, 144], [273, 145]], 'rojo', { encima: true, aguada: true }),
    rojo([[273, 135], [281, 136]], { g: 1 }),

    // El oro: el puño de la barra.
    plano([[234, 54], [244, 53], [245, 64], [235, 65]], 'oro', { encima: true, aguada: true, opacidad: 0.8 }),

    nota(16, 78, 'se lee…', { tam: 20, giro: -6, tinta: 'lapiz' }),
  ],
};
