/**
 * La escuadra de Escribir: un cartabón con su hueco y unas pocas marcas, y al
 * lado un triángulo amarillo encajado a lápiz (la base, la altura, el arco del
 * compás). Escribir también se hace a escuadra.
 */
import { type Dibujo, tinta, lapiz, rojo, plano, nota, circulo } from '../boceto';

export const escuadra: Dibujo = {
  id: 'escuadra',
  ancho: 140,
  alto: 90,
  duracion: 1.2,
  titulo: 'Una escuadra junto a un triángulo amarillo',
  descripcion: 'Una escuadra de dibujo con el hueco en medio y, a su lado, un pequeño triángulo amarillo encajado con líneas de lápiz. Encima, a mano: «a escuadra».',
  elementos: [
    // Encaje del triángulo: base, altura, arco.
    lapiz([[84, 82], [136, 82]], { g: 0.8 }),
    lapiz([[111, 40], [111, 86]], { g: 0.6 }),
    lapiz(circulo([90, 80], 40, 4, 285, 325), { recto: false, g: 0.6 }),
    plano([[92, 80], [130, 81], [111, 48]], 'amarillo'),
    tinta([[111, 45], [90, 81], [118, 82]], { g: 1.6, recto: true }),
    // La escuadra: el canto repasado, el hueco, la hipotenusa que se corrige.
    tinta([[12, 8], [12, 82], [80, 82]], { g: 2, recto: true, pasadas: 2 }),
    tinta([[13, 6], [82, 80]], { g: 1.8, recto: true }),
    tinta([[22, 34], [22, 73], [58, 73]], { g: 1.2, recto: true }),
    tinta([[22, 34], [57, 72]], { g: 1, recto: true, temblor: 1 }),
    // Marcas del canto y el ángulo recto en minio.
    tinta([[30, 82], [30, 78]], { g: 1, recto: true }),
    tinta([[48, 82], [48, 78]], { g: 1, recto: true }),
    rojo([[12, 70], [24, 70], [24, 82]], { g: 1.2, recto: true }),
    nota(54, 22, 'a escuadra', { tam: 13, giro: -6 }),
  ],
};
