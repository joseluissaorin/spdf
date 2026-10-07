/**
 * La biblioteca vacía: una balda trazada con regla, sobre sus dos ménsulas,
 * con un sujetalibros y un solo libro que se ha quedado inclinado contra él.
 * A la izquierda, a lápiz, los lomos de los libros que todavía no están.
 */
import { type Dibujo, tinta, lapiz, plano, sombra, nota } from '../boceto';

export const estante: Dibujo = {
  id: 'estante',
  ancho: 420,
  alto: 220,
  duracion: 2,
  titulo: 'Una balda vacía con un solo libro',
  descripcion:
    'Una balda de madera dibujada a pluma sobre dos ménsulas, con un sujetalibros a la derecha y un único libro inclinado apoyado en él. A la izquierda, a lápiz, se adivinan los lomos de los libros que aún no han llegado, y una nota a mano dice: «aquí irán tus libros».',
  elementos: [
    // La regla: la línea de la balda, más larga que la balda.
    lapiz([[4, 151], [416, 148]]),
    lapiz([[60, 164], [60, 212]], { g: 0.6 }),
    lapiz([[350, 164], [350, 212]], { g: 0.6 }),

    // Los lomos que aún no están, a lápiz y sin cerrar.
    lapiz([[94, 150], [94, 82], [114, 81], [115, 150]]),
    lapiz([[118, 150], [118, 96], [134, 95], [135, 150]], { g: 0.7 }),
    lapiz([[140, 150], [139, 70], [166, 69], [167, 148]]),
    lapiz([[172, 150], [190, 88], [206, 92], [190, 150]], { g: 0.7 }),
    lapiz([[212, 150], [212, 104], [230, 103]], { g: 0.6 }),

    // La balda: el canto, repasado; el grueso, de una pasada.
    tinta([[26, 150], [210, 149], [394, 147]], { g: 2.6, recto: true, pasadas: 2 }),
    tinta([[28, 164], [200, 164], [390, 162]], { g: 2, recto: true }),
    tinta([[26, 150], [28, 165]], { g: 1.8, recto: true }),
    tinta([[394, 147], [391, 162]], { g: 1.8, recto: true }),
    // Arrepentimiento: el canto derecho primero quedó más largo.
    tinta([[396, 146], [404, 147], [402, 158]], { g: 0.9, temblor: 1.1 }),

    // Las ménsulas, con su voluta.
    tinta([[62, 164], [62, 206], [68, 200], [76, 184], [90, 170], [100, 164]], { g: 2.2 }),
    tinta([[66, 196], [72, 196], [72, 190]], { g: 1.2 }),
    tinta([[348, 163], [348, 205], [342, 199], [334, 183], [320, 169], [310, 164]], { g: 2.2 }),
    tinta([[344, 195], [338, 195], [338, 189]], { g: 1.2 }),
    sombra([[100, 165], [340, 164], [330, 176], [110, 177]], 60, 6, { cobertura: 0.55, g: 0.8 }),

    // El sujetalibros: una chapa de canto con el remate doblado.
    tinta([[302, 148], [302, 82], [305, 76], [310, 74], [314, 77], [312, 84]], { g: 2.4, pasadas: 2 }),
    tinta([[312, 84], [312, 148]], { g: 2 }),
    tinta([[252, 146], [300, 146]], { g: 1.4, recto: true }),
    sombra([[304, 86], [311, 86], [311, 146], [304, 146]], 50, 4, { cobertura: 0.7, g: 0.8 }),

    // El libro, caído contra el sujetalibros.
    tinta([[259, 144], [279, 77], [300, 83], [279, 150], [259, 144]], { g: 2.4, recto: true }),
    tinta([[262, 132], [282, 138]], { g: 1.3 }),
    tinta([[275, 90], [294, 96]], { g: 1.3 }),
    tinta([[281, 79], [284, 72], [304, 78], [301, 84]], { g: 1.2 }),
    plano([[266, 119], [285, 125], [289, 112], [270, 106]], 'rojo', { encima: true, aguada: true, opacidad: 0.85 }),
    sombra([[259, 144], [266, 120], [286, 126], [279, 150]], 70, 5, { cobertura: 0.45, g: 0.7 }),

    nota(40, 46, 'aquí irán\ntus libros', { tam: 20, giro: -4 }),
    lapiz([[96, 66], [110, 74], [118, 86]], { recto: false, g: 0.8 }),
  ],
};
