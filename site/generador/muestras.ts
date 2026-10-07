/**
 * Las muestras del validador: las genera muestras/generar.ts (un librito sobre
 * SPDF impreso a PDF y leído a SPDF, más una copia rota) y se publican tal cual
 * desde public/muestras/. Aquí solo se lee su inventario.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SITIO, type Lengua } from './sitio';

export interface Muestra { url: string; fichero: string; nombre: Record<Lengua, string>; bytes: number; sha256: string; valido: boolean; codigos: string[] }

const inventario = resolve(SITIO, 'public/muestras/muestras.json');
export const MUESTRAS: Muestra[] = existsSync(inventario)
  ? (JSON.parse(readFileSync(inventario, 'utf8')) as Omit<Muestra, 'url'>[]).map((m) => ({ ...m, url: `/muestras/${m.fichero}` }))
  : [];
