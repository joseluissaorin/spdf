/**
 * La regla de la Biblioteca: una regla con sus marcas y, encima, un cuadrado
 * rojo girado sobre una punta, con las diagonales a lápiz. La biblioteca es lo
 * que se mide antes de cortar.
 */
import { type Dibujo, tinta, lapiz, plano, nota, sombra } from '../boceto';

export const regla: Dibujo = {
  id: 'regla',
  ancho: 140,
  alto: 90,
  duracion: 1.2,
  titulo: 'Una regla y un cuadrado rojo girado',
  descripcion: 'Una regla graduada tendida abajo y, encima, un cuadrado rojo apoyado sobre una punta, con sus dos diagonales a lápiz. Al lado, a mano: «mide dos veces».',
  elementos: [
    // Las diagonales del cuadrado, y el cuadrado.
    lapiz([[30, 32], [74, 32]], { g: 0.7 }),
    lapiz([[52, 6], [52, 60]], { g: 0.7 }),
    plano([[52, 11], [72, 32], [52, 53], [31, 32]], 'rojo'),
    tinta([[51, 8], [74, 32], [52, 56]], { g: 1.6, recto: true }),
    // La regla: dos cantos, el de abajo con dos pasadas, y la cabeza.
    tinta([[6, 64], [134, 62], [134, 78]], { g: 1.8, recto: true }),
    tinta([[6, 64], [7, 80], [134, 78]], { g: 1.8, recto: true, pasadas: 2 }),
    // Las marcas, a pulso: largas, cortas.
    tinta([[22, 63.5], [22, 71]], { g: 1, recto: true }),
    tinta([[46, 63], [46, 68]], { g: 0.9, recto: true }),
    tinta([[70, 63], [70, 71]], { g: 1, recto: true }),
    tinta([[94, 62.5], [94, 68]], { g: 0.9, recto: true }),
    tinta([[118, 62], [118, 70]], { g: 1, recto: true }),
    sombra([[8, 74], [132, 72], [132, 77], [8, 79]], 60, 4, { cobertura: 0.55, g: 0.6 }),
    nota(82, 26, 'mide dos\nveces', { tam: 13, giro: -5 }),
  ],
};
