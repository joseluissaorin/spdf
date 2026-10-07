/**
 * Buscar sin resultados: una lupa de mango torneado sobre una página de
 * renglones garabateados, con la esquina doblada y su folio. Dentro de la
 * lente dos renglones se ven gordos, como se ven; y aun así no hay nada.
 */
import { type Dibujo, tinta, lapiz, plano, sombra, nota } from '../boceto';

export const lupa: Dibujo = {
  id: 'lupa',
  ancho: 360,
  alto: 240,
  duracion: 2,
  titulo: 'Una lupa sobre una página',
  descripcion:
    'Una lupa de mango torneado, dibujada a pluma, sobre una página de renglones garabateados con una esquina doblada. Dentro de la lente, dos renglones se ven más grandes. Al margen, a mano: «nada por aquí… todavía».',
  elementos: [
    // Encaje: el eje de la lupa y el borde de la mesa.
    lapiz([[146, 64], [312, 230]], { g: 0.6 }),
    lapiz([[20, 226], [340, 222]]),

    // La página, con la esquina doblada.
    tinta([[214, 26], [40, 34], [46, 224], [252, 218], [247, 60]], { g: 2.2, recto: true }),
    tinta([[214, 26], [221, 54], [247, 60], [214, 26]], { g: 1.6, recto: true }),
    sombra([[216, 32], [221, 54], [242, 58]], 40, 4, { cobertura: 0.6, g: 0.7 }),

    // Los renglones, a garabato; se cortan donde empieza la lente.
    tinta([[58, 58], [80, 55], [102, 59], [126, 56], [150, 59], [176, 56], [196, 58]], { g: 1.2 }),
    tinta([[58, 78], [84, 75], [108, 79], [132, 76], [152, 78]], { g: 1.2 }),
    tinta([[58, 98], [78, 95], [100, 99], [124, 96], [146, 98]], { g: 1.2 }),
    tinta([[58, 118], [82, 115], [106, 119], [128, 116], [144, 118]], { g: 1.2 }),
    tinta([[58, 138], [80, 135], [104, 139], [126, 136], [148, 138]], { g: 1.2 }),
    tinta([[58, 158], [84, 155], [110, 159], [134, 156], [158, 158]], { g: 1.2 }),
    tinta([[58, 178], [82, 175], [108, 179], [134, 176], [160, 179], [186, 176], [204, 178]], { g: 1.2 }),
    tinta([[58, 198], [80, 195], [104, 199], [124, 196]], { g: 1.2 }),

    // La lente: el cristal, el aro repasado, y un aro primero más pequeño.
    plano([[250, 118], [243, 143], [225, 161], [200, 168], [175, 161], [157, 143], [150, 118], [157, 93], [175, 75], [200, 68], [225, 75], [243, 93]], 'azul', { aguada: true, opacidad: 0.16 }),
    tinta([[200, 68], [225, 75], [243, 93], [250, 118], [243, 143], [225, 161], [200, 168], [175, 161], [157, 143], [150, 118], [157, 93], [175, 75], [202, 67]], { g: 2.8, pasadas: 2 }),
    tinta([[162, 96], [178, 80], [200, 74], [222, 80]], { g: 1, temblor: 1.1 }),

    // Dentro, los renglones engordados.
    tinta([[160, 102], [178, 96], [198, 104], [220, 96], [240, 102]], { g: 3.2 }),
    tinta([[158, 132], [176, 126], [196, 134], [218, 126], [236, 132]], { g: 3.2 }),

    // El mango: virola, dos bultos torneados y el remate.
    tinta([[237, 148], [247, 158], [250, 156], [255, 162], [255, 165], [269, 173], [278, 187], [292, 196], [300, 210], [301, 216], [296, 219], [292, 218]], { g: 2.4 }),
    tinta([[230, 155], [240, 165], [238, 168], [244, 173], [247, 173], [255, 187], [269, 196], [278, 210], [292, 218]], { g: 2.4 }),
    tinta([[247, 158], [238, 168]], { g: 1.4, recto: true }),
    tinta([[255, 162], [244, 173]], { g: 1.4, recto: true }),
    tinta([[273, 186], [270, 196]], { g: 1.2 }),
    sombra([[244, 173], [255, 187], [269, 196], [278, 210], [290, 216], [280, 200], [266, 188], [252, 176]], 30, 4, { cobertura: 0.6, g: 0.8 }),
    // La sombra de la lente sobre la página.
    sombra([[150, 128], [160, 152], [180, 168], [204, 174], [190, 180], [162, 170], [148, 150]], -50, 5, { cobertura: 0.5, g: 0.8 }),

    nota(150, 214, '37', { tam: 13, ancla: 'middle', tinta: 'tinta' }),
    nota(262, 44, 'nada por\naquí…', { tam: 19, giro: -5 }),
    nota(274, 92, 'todavía', { tam: 18, giro: -8, tinta: 'rojo' }),
  ],
};
