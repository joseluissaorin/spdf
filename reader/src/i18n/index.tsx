/**
 * Idioma de la interfaz: el del sistema por defecto (navigator.languages; en
 * Tauri, el webview recibe el del sistema), o el que elija el usuario.
 */
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { es, type Claves } from './es';
import { en } from './en';
import type { Lengua } from '../nucleo/tipos';

const DICCIONARIOS: Record<Lengua, Record<Claves, string>> = { es, en };

export function lenguaDelSistema(): Lengua {
  const ls = typeof navigator !== 'undefined' ? navigator.languages ?? [navigator.language] : [];
  for (const l of ls) {
    const b = l.toLowerCase().slice(0, 2);
    if (b === 'es' || b === 'ca' || b === 'gl' || b === 'eu') return 'es';
    if (b === 'en') return 'en';
  }
  return 'en';
}

export type T = (k: Claves, v?: Record<string, string | number>) => string;

export function traductor(l: Lengua): T {
  const d = DICCIONARIOS[l];
  return (k, v) => {
    let s = d[k] ?? es[k] ?? k;
    if (v) for (const [a, b] of Object.entries(v)) s = s.replaceAll(`{${a}}`, String(b));
    return s;
  };
}

interface Ctx { lengua: Lengua; t: T }
const Contexto = createContext<Ctx>({ lengua: 'es', t: traductor('es') });

export function ProveedorIdioma({ lengua, children }: { lengua: Lengua; children: ReactNode }) {
  const v = useMemo(() => ({ lengua, t: traductor(lengua) }), [lengua]);
  return <Contexto.Provider value={v}>{children}</Contexto.Provider>;
}

export const useIdioma = () => useContext(Contexto);

/** Bytes legibles: 157 MB, 1,4 GB (coma decimal en español). */
export function tamano(b: number, l: Lengua): string {
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (b >= 1000 && i < u.length - 1) { b /= 1000; i++; }
  return `${b.toLocaleString(l, { maximumFractionDigits: b < 10 && i > 1 ? 1 : 0 })} ${u[i]}`;
}

/** Segundos como h:mm:ss o m:ss. */
export function reloj(s: number): string {
  s = Math.max(0, Math.floor(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`;
}
