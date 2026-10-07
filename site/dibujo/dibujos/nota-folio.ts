/**
 * Nota al margen para la primera vez: «p. 145», el folio de la cita, rodeado
 * con un círculo de minio que se pasa de vuelta, y una flecha corta hacia
 * abajo, hacia el renglón de donde sale.
 */
import { type Dibujo, tinta, rojo, lapiz, nota } from '../boceto';

export const notaFolio: Dibujo = {
  id: 'nota-folio',
  ancho: 150,
  alto: 70,
  duracion: 1.1,
  titulo: 'Una nota a mano que dice «p. 145»',
  descripcion: 'El folio «p. 145» escrito a mano, rodeado por un círculo rojo a pluma que da algo más de una vuelta, y una flecha corta que apunta hacia abajo.',
  elementos: [
    lapiz([[44, 34], [106, 33]], { g: 0.6 }),
    nota(75, 31, 'p. 145', { tam: 23, tinta: 'tinta', giro: -3, ancla: 'middle' }),
    rojo([[54, 8], [32, 15], [30, 31], [48, 42], [78, 44], [106, 39], [116, 25], [104, 11], [80, 6], [56, 9], [40, 18]], { g: 1.8 }),
    tinta([[76, 46], [77, 55], [76, 64]], { g: 1.6 }),
    tinta([[70, 57], [76, 65], [82, 58]], { g: 1.4 }),
  ],
};
