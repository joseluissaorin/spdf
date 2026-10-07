/** Importar ficheros (web: File; Tauri: rutas) con aviso de progreso y de errores. */
import { useCallback } from 'react';
import { useApp } from '../app/estado';
import { useIdioma } from '../i18n';

export function useImportar() {
  const { nucleo, refrescar, avisar, ir } = useApp();
  const { t } = useIdioma();
  return useCallback(async (origen: (File | string)[], o: { abrir?: boolean } = {}) => {
    const spdf = origen.filter((f) => (typeof f === 'string' ? f : f.name).toLowerCase().match(/\.spdf(\.gz)?$|\.db$/) || typeof f !== 'string');
    if (!spdf.length) return [];
    if (spdf.length > 1) avisar(t('importando', { n: 0, total: spdf.length }));
    const r = await nucleo.importar(spdf);
    await refrescar();
    for (const x of r) {
      if (!x.ok) avisar(t('noImportado', { nombre: x.nombre, error: legible(x.error ?? '', t) }), { tipo: 'error' });
      else if (x.repetido && !o.abrir) avisar(t('repetido', { nombre: x.nombre }));
    }
    const buenos = r.filter((x) => x.ok && x.entrada);
    if (buenos.length > 1) avisar(t('importados', { n: buenos.length }));
    if ((o.abrir || buenos.length === 1) && buenos[0]?.entrada) ir({ vista: 'leer', id: buenos[0].entrada.id, u: buenos[0].entrada.ultimaUnidad });
    return r;
  }, [nucleo, refrescar, avisar, ir, t]);
}

/** Convierte «E020: …» en el texto del diccionario si lo hay. */
export function legible(e: string, t: (k: never) => string): string {
  const m = /\b(E0\d\d)\b/.exec(e);
  if (m) {
    const s = (t as (k: string) => string)(m[1]);
    if (s && s !== m[1]) return s;
  }
  return e;
}
