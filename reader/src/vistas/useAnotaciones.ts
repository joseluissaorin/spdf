/** Las anotaciones de un documento: se leen y se guardan en su fichero hermano (.spdfa.json). */
import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../app/estado';
import type { Resumen } from '../nucleo/tipos';
import { aW3C, deW3C, type Anotacion } from '../util/anotaciones';
import { aMarkdown } from '../util/markdown';

export interface Anotaciones {
  lista: Anotacion[];
  anadir: (a: Omit<Anotacion, 'id' | 'creada'>) => Promise<void>;
  borrar: (id: string) => Promise<void>;
  editar: (id: string, nota: string) => Promise<void>;
  importar: (json: string) => Promise<number>;
  exportarW3C: () => Promise<void>;
  exportarMarkdown: () => Promise<void>;
}

export function useAnotaciones(id: string, resumen: Resumen | null): Anotaciones {
  const { nucleo, lengua, entradas } = useApp();
  const [lista, setLista] = useState<Anotacion[]>([]);
  const entrada = entradas?.find((e) => e.id === id);

  useEffect(() => {
    let vivo = true;
    nucleo.leerAnotaciones(id).then((j) => { if (vivo) setLista(j ? deW3C(j) : []); }).catch(() => vivo && setLista([]));
    return () => { vivo = false; };
  }, [id, nucleo]);

  const docref = resumen ? `sha256-${resumen.document.source_sha256}` : '';
  const titulo = resumen?.document.metadata?.title ?? entrada?.titulo ?? '';
  const serializar = useCallback((l: Anotacion[]) => aW3C(l, { titulo, docref, lengua, generador: `spdf-reader/${__VERSION__}` }), [titulo, docref, lengua]);

  const guardar = useCallback(async (l: Anotacion[]) => {
    setLista(l);
    await nucleo.guardarAnotaciones(id, serializar(l));
  }, [nucleo, id, serializar]);

  return {
    lista,
    anadir: (a) => guardar([...lista, { ...a, id: crypto.randomUUID(), creada: new Date().toISOString() }]),
    borrar: (x) => guardar(lista.filter((a) => a.id !== x)),
    editar: (x, nota) => guardar(lista.map((a) => (a.id === x ? { ...a, nota: nota || undefined, tipo: nota ? 'nota' : 'subrayado' } : a))),
    importar: async (json) => { const n = deW3C(json); await guardar([...lista, ...n.filter((a) => !lista.some((b) => b.id === a.id))]); return n.length; },
    exportarW3C: async () => { await nucleo.guardarComo(`${(entrada?.nombre ?? 'documento').replace(/\.spdf$/i, '')}.spdfa.json`, serializar(lista), 'application/ld+json'); },
    exportarMarkdown: async () => {
      const ref = await import('../util/citeproc').then((m) => m.referenciaFormateada({ ...(resumen!.document.metadata), id: resumen!.document.id }, 'apa', lengua)).then((r) => r.texto).catch(() => '');
      const md = aMarkdown({ titulo, autores: entrada?.autores ?? '', anio: entrada?.anio ?? null, referencia: ref || titulo, anotaciones: lista, lengua });
      await nucleo.guardarComo(`${(entrada?.nombre ?? 'documento').replace(/\.spdf$/i, '')}.md`, md, 'text/markdown');
    },
  };
}
