/**
 * El compás de Buscar y Ajustes: un compás de dos patas, abierto, con la aguja
 * clavada en el centro de un círculo azul y la mina dando la vuelta a lápiz.
 * Buscar es eso: un centro quieto y un radio que se abre.
 */
import { type Dibujo, tinta, lapiz, rojo, disco, nota, circulo } from '../boceto';

export const compas: Dibujo = {
  id: 'compas',
  ancho: 140,
  alto: 90,
  duracion: 1.2,
  titulo: 'Un compás junto a un círculo azul',
  descripcion: 'Un compás abierto, con la aguja en el centro de un pequeño círculo azul, traza a lápiz un arco a su alrededor. Al lado, a mano: «el centro, quieto».',
  elementos: [
    // El arco que va dejando la mina, y la pata que antes se abrió de más.
    lapiz(circulo([42, 60], 27, 10, 15, 300), { recto: false, g: 0.8 }),
    lapiz([[56, 9], [84, 58]], { g: 0.6 }),
    disco([42, 60], 15, 'azul', { aguada: true, opacidad: 0.9 }),
    // La cabeza, el gozne y las dos patas.
    tinta([[55, 2], [55, 7]], { g: 1.6 }),
    tinta([[51, 10], [54, 7], [58, 8], [59, 12], [55, 14], [51, 12]], { g: 1.4 }),
    tinta([[53, 14], [47, 38], [42, 59]], { g: 2, pasadas: 2 }),
    tinta([[57, 14], [63, 38], [67, 52]], { g: 2 }),
    tinta([[66, 52], [69, 56], [69.5, 61]], { g: 1.2 }),
    rojo([[40, 58], [44, 62]], { g: 1.2, recto: true }),
    rojo([[44, 58], [40, 62]], { g: 1.2, recto: true }),
    nota(84, 22, 'el centro,\nquieto', { tam: 13, giro: -5 }),
  ],
};
