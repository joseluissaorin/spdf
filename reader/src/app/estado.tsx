/**
 * El estado que comparte toda la interfaz: el núcleo, las preferencias, la
 * biblioteca, los avisos y la última búsqueda (que sobrevive a abrir un
 * resultado y volver: la lista sigue en su sitio).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Nucleo, EntradaBiblioteca, Coleccion, ResultadoBusqueda } from '../nucleo/nucleo';
import type { Lengua, ModoBusqueda } from '../nucleo/tipos';
import { lenguaDelSistema, ProveedorIdioma } from '../i18n';
import { useRuta, type Ruta } from './ruta';

export interface Prefs {
  tema: 'sistema' | 'claro' | 'oscuro';
  idioma: 'sistema' | Lengua;
  tamTexto: number;
  vista: 'ambos' | 'texto' | 'facsimil';
}
const PREFS: Prefs = { tema: 'sistema', idioma: 'sistema', tamTexto: 19, vista: 'ambos' };

export interface Aviso { id: number; texto: string; tipo?: 'error' | 'info'; accion?: { texto: string; hacer: () => void } }

export interface Busqueda {
  consulta: string;
  modo: ModoBusqueda;
  ambito: string; // id, 'biblioteca' o '' (aún sin elegir: el documento abierto)
  resultado: ResultadoBusqueda | null;
  actual: number; // índice del resultado abierto
  scroll: number;
}

interface Ctx {
  nucleo: Nucleo;
  prefs: Prefs;
  cambiarPrefs: (p: Partial<Prefs>) => void;
  lengua: Lengua;
  oscuro: boolean;
  entradas: EntradaBiblioteca[] | null;
  colecciones: Coleccion[];
  refrescar: () => Promise<void>;
  avisar: (texto: string, o?: Omit<Aviso, 'id' | 'texto'>) => void;
  avisos: Aviso[];
  quitarAviso: (id: number) => void;
  ruta: Ruta;
  ir: (r: Ruta, reemplazar?: boolean) => void;
  busqueda: Busqueda;
  setBusqueda: (b: Partial<Busqueda>) => void;
}

const Contexto = createContext<Ctx | null>(null);
export const useApp = () => {
  const c = useContext(Contexto);
  if (!c) throw new Error('useApp fuera del proveedor');
  return c;
};

function leerPrefs(): Prefs {
  try { return { ...PREFS, ...JSON.parse(localStorage.getItem('spdf-lector:prefs') ?? '{}') }; } catch { return PREFS; }
}

let n = 0;

export function ProveedorApp({ nucleo, children }: { nucleo: Nucleo; children: ReactNode }) {
  const [prefs, setPrefs] = useState<Prefs>(leerPrefs);
  const [sistemaOscuro, setSistemaOscuro] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches);
  const [entradas, setEntradas] = useState<EntradaBiblioteca[] | null>(null);
  const [colecciones, setColecciones] = useState<Coleccion[]>([]);
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const [ruta, ir] = useRuta();
  const [busqueda, setB] = useState<Busqueda>({ consulta: '', modo: 'lexica', ambito: '', resultado: null, actual: -1, scroll: 0 });

  useEffect(() => {
    const m = matchMedia('(prefers-color-scheme: dark)');
    const f = () => setSistemaOscuro(m.matches);
    m.addEventListener('change', f);
    return () => m.removeEventListener('change', f);
  }, []);

  const oscuro = prefs.tema === 'oscuro' || (prefs.tema === 'sistema' && sistemaOscuro);
  const lengua: Lengua = prefs.idioma === 'sistema' ? lenguaDelSistema() : prefs.idioma;

  useEffect(() => {
    const h = document.documentElement;
    h.classList.toggle('oscuro', oscuro);
    h.lang = lengua;
    h.style.setProperty('--tam-lectura', `${prefs.tamTexto}px`);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', oscuro ? '#1f1712' : '#f5f0e8');
  }, [oscuro, lengua, prefs.tamTexto]);

  const cambiarPrefs = useCallback((p: Partial<Prefs>) => {
    setPrefs((v) => {
      const nv = { ...v, ...p };
      localStorage.setItem('spdf-lector:prefs', JSON.stringify(nv));
      return nv;
    });
  }, []);

  const refrescar = useCallback(async () => {
    const [e, c] = await Promise.all([nucleo.biblioteca(), nucleo.colecciones()]);
    setEntradas(e);
    setColecciones(c);
  }, [nucleo]);

  useEffect(() => { void refrescar(); }, [refrescar]);

  const quitarAviso = useCallback((id: number) => setAvisos((a) => a.filter((x) => x.id !== id)), []);
  const avisar = useCallback((texto: string, o: Omit<Aviso, 'id' | 'texto'> = {}) => {
    const id = ++n;
    setAvisos((a) => [...a.slice(-3), { id, texto, ...o }]);
    setTimeout(() => quitarAviso(id), o.tipo === 'error' ? 8000 : o.accion ? 6000 : 3200);
  }, [quitarAviso]);

  const setBusqueda = useCallback((b: Partial<Busqueda>) => setB((v) => ({ ...v, ...b })), []);

  const v = useMemo<Ctx>(() => ({
    nucleo, prefs, cambiarPrefs, lengua, oscuro, entradas, colecciones, refrescar, avisar, avisos, quitarAviso, ruta, ir, busqueda, setBusqueda,
  }), [nucleo, prefs, cambiarPrefs, lengua, oscuro, entradas, colecciones, refrescar, avisar, avisos, quitarAviso, ruta, ir, busqueda, setBusqueda]);

  return (
    <Contexto.Provider value={v}>
      <ProveedorIdioma lengua={lengua}>{children}</ProveedorIdioma>
    </Contexto.Provider>
  );
}
