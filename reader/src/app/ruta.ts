/**
 * Rutas por hash: funcionan igual servidas bajo /reader/, en file:// y dentro
 * de Tauri, sin configurar nada en el servidor.
 *   #/                      biblioteca
 *   #/c/<coleccion>         una colección
 *   #/leer/<id>/<ord>?f=…   un documento en una unidad (y un fragmento)
 *   #/ajustes
 */
import { useCallback, useEffect, useState } from 'react';

export type Ruta =
  | { vista: 'biblioteca'; coleccion?: string }
  | { vista: 'leer'; id: string; u?: number; f?: string; t?: number }
  | { vista: 'ajustes' };

export function leerRuta(h = location.hash): Ruta {
  const [camino, consulta = ''] = h.replace(/^#/, '').split('?');
  const p = (camino ?? '').split('/').filter(Boolean).map(decodeURIComponent);
  const q = new URLSearchParams(consulta);
  if (p[0] === 'leer' && p[1]) {
    const u = Number(p[2]);
    const t = Number(q.get('t'));
    return { vista: 'leer', id: p[1], u: Number.isFinite(u) && u > 0 ? u : undefined, f: q.get('f') ?? undefined, t: Number.isFinite(t) && q.has('t') ? t : undefined };
  }
  if (p[0] === 'ajustes') return { vista: 'ajustes' };
  if (p[0] === 'c' && p[1]) return { vista: 'biblioteca', coleccion: p[1] };
  return { vista: 'biblioteca' };
}

export function aHash(r: Ruta): string {
  if (r.vista === 'leer') {
    const q = new URLSearchParams();
    if (r.f) q.set('f', r.f);
    if (r.t != null) q.set('t', String(r.t));
    const s = q.toString();
    return `#/leer/${encodeURIComponent(r.id)}${r.u ? `/${r.u}` : ''}${s ? `?${s}` : ''}`;
  }
  if (r.vista === 'ajustes') return '#/ajustes';
  return r.coleccion ? `#/c/${encodeURIComponent(r.coleccion)}` : '#/';
}

export function useRuta(): [Ruta, (r: Ruta, reemplazar?: boolean) => void] {
  const [r, setR] = useState<Ruta>(() => leerRuta());
  useEffect(() => {
    const f = () => setR(leerRuta());
    addEventListener('hashchange', f);
    return () => removeEventListener('hashchange', f);
  }, []);
  const ir = useCallback((n: Ruta, reemplazar = false) => {
    const h = aHash(n);
    if (reemplazar) { history.replaceState(null, '', h); setR(leerRuta(h)); }
    else if (h !== location.hash) location.hash = h;
    else setR(leerRuta(h));
  }, []);
  return [r, ir];
}
