/**
 * Nota al margen para la primera vez: «aquí», escrito deprisa, y una flecha
 * curva a pluma que baja hacia la izquierda, hacia la función que se estrena.
 */
import { type Dibujo, tinta, lapiz, nota } from '../boceto';

export const notaAqui: Dibujo = {
  id: 'nota-aqui',
  ancho: 150,
  alto: 70,
  duracion: 1,
  titulo: 'Una nota a mano que dice «aquí»',
  descripcion: 'La palabra «aquí» escrita a mano y una flecha curva a pluma que sale de ella hacia abajo y a la izquierda.',
  elementos: [
    lapiz([[70, 34], [140, 31]], { g: 0.6 }),
    nota(76, 28, 'aquí', { tam: 26, tinta: 'tinta', giro: -6 }),
    // La flecha: primero tímida, luego decidida.
    tinta([[78, 40], [64, 46], [46, 52]], { g: 0.8, temblor: 1 }),
    tinta([[90, 38], [76, 48], [58, 54], [38, 58], [16, 62]], { g: 1.8 }),
    tinta([[25, 54], [15, 62], [27, 67]], { g: 1.6 }),
  ],
};
