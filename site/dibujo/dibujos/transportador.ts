/**
 * El transportador de Explorar: medio círculo graduado a mano, y a su lado el
 * cuadrado negro de Malévich, pequeño y un poco torcido, con el ángulo medido a
 * lápiz. Explorar es salirse de la escuadra unos grados.
 */
import { type Dibujo, tinta, lapiz, plano, nota, circulo } from '../boceto';

export const transportador: Dibujo = {
  id: 'transportador',
  ancho: 140,
  alto: 90,
  duracion: 1.3,
  titulo: 'Un transportador y un cuadrado negro girado',
  descripcion: 'Un transportador de medio círculo con unas pocas marcas y, a su lado, un pequeño cuadrado negro girado unos grados, con el ángulo medido a lápiz. Debajo, a mano: «12°, a ojo».',
  elementos: [
    // El ángulo del cuadrado, a lápiz: la horizontal, el lado prolongado y el arco.
    lapiz([[94, 53], [134, 53]], { g: 0.7 }),
    lapiz([[96, 52.8], [134, 61]], { g: 0.6 }),
    lapiz(circulo([97.8, 53.2], 22, 3, 0, 12), { recto: false, g: 0.8 }),
    plano([[102.8, 29.8], [126.2, 34.8], [121.2, 58.2], [97.8, 53.2]], 'tinta'),
    // El transportador: el arco de fuera, el de dentro y la base.
    tinta([[6, 78], [10, 58], [22, 44], [36, 36.5], [52, 34], [68, 36.5], [82, 44], [93, 57], [96, 76]], { g: 1.8, pasadas: 2 }),
    tinta([[24, 77], [27, 66], [36, 58], [52, 54], [68, 58], [77, 66], [80, 77]], { g: 1 }),
    tinta([[4, 78], [97, 79]], { g: 1.8, recto: true }),
    // Las marcas: noventa, treinta, ciento cincuenta; y el centro.
    tinta([[52, 34], [52, 43]], { g: 1, recto: true }),
    tinta([[90.1, 56], [84.9, 59]], { g: 1, recto: true }),
    tinta([[13.9, 56], [19.1, 59]], { g: 1, recto: true }),
    tinta([[48, 78], [52, 73], [56, 78]], { g: 1, recto: true }),
    nota(139, 88, '12°, a ojo', { tam: 12, giro: -4, ancla: 'end' }),
  ],
};
