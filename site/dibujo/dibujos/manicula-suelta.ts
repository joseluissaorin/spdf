/**
 * La manícula de la portada, la misma mano, girada para que señale hacia
 * abajo: la manga entra por arriba y el índice apunta al sitio donde se suelta
 * el archivo. Las coordenadas son las de la portada, giradas un cuarto de
 * vuelta y vueltas a encajar a lápiz.
 */
import { type Dibujo, tinta, lapiz, sombra, nota, plano, circulo } from '../boceto';

export const maniculaSuelta: Dibujo = {
  id: 'manicula-suelta',
  ancho: 260,
  alto: 300,
  duracion: 2.2,
  titulo: 'Una manícula que señala hacia abajo',
  descripcion:
    'La mano con el índice extendido de los márgenes antiguos sale de una manga con puño de encaje y señala hacia abajo, al lugar donde se sueltan los archivos. Al lado, a lápiz: «suéltalo aquí».',
  elementos: [
    // Encaje a lápiz: el eje del dedo, la caja de la manga, el círculo del puño y el suelo.
    lapiz([[137, 10], [135, 292]]),
    lapiz([[151, 164], [150, 277], [122, 283], [124, 166]], { cerrado: true, g: 0.7 }),
    lapiz([[162, 15], [166, 83], [65, 87], [68, 16]], { cerrado: true }),
    lapiz(circulo([105, 156], 58, 14), { recto: false }),
    lapiz([[86, 294], [190, 292]], { g: 0.8 }),

    // La manga, que entra por arriba.
    tinta([[155, 0], [157, 35], [161, 63], [162, 79]], { g: 2.6 }),
    tinta([[74, 0], [72, 37], [69, 67], [68, 81]], { g: 2.6 }),
    tinta([[141, 2], [144, 47], [146, 74]], { g: 1.2 }),
    // El puño de encaje: el festón, ahora de través.
    tinta([[167, 79], [160, 87], [152, 81], [144, 89], [135, 82], [126, 90], [117, 83], [109, 91], [100, 84], [91, 91], [83, 84], [74, 92], [64, 83]], { g: 2.2 }),
    tinta([[165, 76], [124, 77], [65, 78]], { g: 1.6, pasadas: 2 }),

    // El dorso, de la muñeca al nudillo.
    tinta([[156, 91], [162, 109], [161, 132], [153, 149], [148, 163]], { g: 2.8 }),
    // El índice: un lado, la yema, el otro.
    tinta([[148, 163], [148, 196], [148, 233], [147, 260]], { g: 2.8 }),
    tinta([[147, 260], [145, 273], [137, 279], [129, 274], [126, 260]], { g: 3 }),
    tinta([[126, 260], [126, 227], [126, 194], [127, 172]], { g: 2.5 }),
    // Arrepentimiento: la yema primero salió más larga.
    tinta([[147, 267], [141, 282], [131, 283], [125, 270]], { g: 1, temblor: 1.1 }),
    // La uña.
    tinta([[145, 254], [145, 264], [140, 270], [135, 269], [135, 260]], { g: 1.3 }),
    // Pliegues de las falanges.
    tinta([[145, 196], [137, 198], [129, 196]], { g: 1.3 }),
    tinta([[144, 231], [135, 232]], { g: 1 }),

    // El pulgar, recogido.
    tinta([[125, 156], [124, 185], [121, 207], [116, 217], [110, 212], [109, 196], [110, 169]], { g: 2.4 }),
    // Los tres dedos doblados.
    tinta([[109, 165], [105, 179], [98, 182], [93, 175], [93, 158]], { g: 2.4 }),
    tinta([[91, 161], [88, 172], [80, 175], [77, 167], [77, 153]], { g: 2.4 }),
    tinta([[75, 155], [72, 164], [65, 164], [63, 156], [65, 143]], { g: 2.2 }),
    // La palma, de la muñeca al meñique.
    tinta([[72, 92], [65, 115], [65, 143]], { g: 2.6 }),

    // Sombra de la manga, a medias, y bajo los dedos.
    sombra([[140, 4], [145, 74], [70, 77], [73, 4]], 152, 7, { cobertura: 0.6, g: 0.9 }),
    sombra([[105, 143], [94, 172], [65, 165], [65, 141]], 60, 6, { cobertura: 0.5, g: 0.8 }),

    // El toque de color: el puño. En oro, que sobre el fondo rojo se sigue viendo.
    plano([[164, 74], [166, 82], [65, 85], [64, 76]], 'oro', { encima: true, aguada: true, opacidad: 0.85 }),

    nota(176, 220, 'suéltalo\naquí', { tam: 22, giro: -6, tinta: 'lapiz' }),
    lapiz([[182, 252], [158, 274]], { g: 0.8, recto: false }),
  ],
};
