/**
 * <Boceto>: un dibujo a mano que se dibuja solo la primera vez que entra en
 * pantalla. Primero va el lápiz, luego la pluma y al final el color y las notas.
 * Es la versión portátil del componente de Scholaris (apps/web/src/bocetos/boceto.tsx).
 *
 *   <Boceto dibujo={tintero} />                          // el dibujo ya importado
 *   <Boceto carga={() => import('./dibujos/tintero').then(m => m.tintero)} caja={[340, 240]} />
 *
 * - Mientras llega el motor o el dibujo, la caja ya ocupa su sitio (aspect-ratio):
 *   no hay saltos de diseño. Para eso, con `carga` hay que pasar `caja`.
 * - El SVG se calcula una vez por dibujo y se guarda en caché.
 * - Las máscaras necesitan ids únicos: cada uso lleva su propio sufijo.
 * - Con prefers-reduced-motion aparece ya terminado.
 * - `decorativo` si el texto de al lado ya dice lo que muestra; si no, el SVG lleva <title> y <desc>.
 * Necesita dibujos.css.
 */
import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import type { Dibujo, Lengua } from './boceto';

const cache = new Map<string, Promise<string>>();

function svgDe(clave: string, obtener: () => Promise<Dibujo>, decorativo: boolean, espera: number, lengua: Lengua, sufijo: string): Promise<string> {
  const k = `${clave}|${decorativo ? 1 : 0}|${espera}|${lengua}`;
  let p = cache.get(k);
  if (!p) {
    p = Promise.all([import('./boceto'), obtener()]).then(([{ aSvg }, d]) => aSvg(d, { decorativo, espera, lengua, sufijo: 'SFX' }));
    cache.set(k, p);
  }
  return p.then((s) => s.replace(/SFX/g, sufijo));
}

export interface PropsBoceto {
  /** El dibujo ya importado… */
  dibujo?: Dibujo;
  /** …o una carga diferida (con `caja`, para reservar el sitio). */
  carga?: () => Promise<Dibujo>;
  /** [ancho, alto] de lo que se enseña: la `caja` del dibujo si la tiene, si no ancho × alto. */
  caja?: readonly [number, number];
  /** Si se usa `carga`, un nombre estable para la caché (por defecto, el id que devuelva). */
  nombre?: string;
  lengua?: Lengua;
  className?: string;
  style?: CSSProperties;
  decorativo?: boolean;
  /** Segundos antes de empezar. */
  espera?: number;
  /** Cuándo se dibuja: 'vista' (al entrar en pantalla), 'ya' (al montarse) o un booleano controlado. */
  dibujar?: 'vista' | 'ya' | boolean;
  /** Multiplica la duración (0.5 = el doble de deprisa). */
  ritmo?: number;
}

export function Boceto({ dibujo, carga, caja, nombre, lengua = 'es', className, style, decorativo = false, espera = 0, dibujar = 'vista', ritmo = 1 }: PropsBoceto) {
  const id = useId().replace(/[^a-z0-9]/gi, '');
  const [svg, setSvg] = useState<string | null>(null);
  const [visto, setVisto] = useState(dibujar === true);
  const raiz = useRef<HTMLSpanElement>(null);
  const [w, h] = caja ?? (dibujo ? [dibujo.caja?.[2] ?? dibujo.ancho, dibujo.caja?.[3] ?? dibujo.alto] : [4, 3]);
  const [anima] = useState(() => typeof window !== 'undefined' && 'IntersectionObserver' in window && !matchMedia('(prefers-reduced-motion: reduce)').matches);

  useEffect(() => {
    let vivo = true;
    const obtener = dibujo ? () => Promise.resolve(dibujo) : carga;
    if (!obtener) return;
    void svgDe(nombre ?? dibujo?.id ?? String(carga), obtener, decorativo, espera, lengua, id).then((s) => vivo && setSvg(s));
    return () => { vivo = false; };
  }, [dibujo, carga, nombre, decorativo, espera, lengua, id]);

  useEffect(() => {
    if (typeof dibujar === 'boolean') { setVisto(dibujar); return; }
    if (!svg) return;
    let r2 = 0;
    // Dos fotogramas: el SVG se pinta en blanco y después corre la pluma.
    const lanzar = () => { const r1 = requestAnimationFrame(() => { r2 = requestAnimationFrame(() => setVisto(true)); }); return () => { cancelAnimationFrame(r1); cancelAnimationFrame(r2); }; };
    if (dibujar === 'ya' || !('IntersectionObserver' in window)) return lanzar();
    const el = raiz.current;
    if (!el) return;
    let parar: (() => void) | undefined;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); parar = lanzar(); } }, { rootMargin: '0px 0px -8% 0px', threshold: 0.2 });
    io.observe(el);
    return () => { io.disconnect(); parar?.(); };
  }, [svg, dibujar]);

  // `visto` va en el <svg>, que es lo que miran las reglas de dibujos.css.
  useEffect(() => { raiz.current?.querySelector('svg.dibujo')?.classList.toggle('visto', visto); }, [visto, svg]);

  return (
    <span
      ref={raiz}
      className={`boceto${anima ? ' anima' : ''}${className ? ` ${className}` : ''}`}
      style={{ aspectRatio: `${w} / ${h}`, ...(ritmo !== 1 ? { ['--ritmo' as string]: ritmo } : null), ...style }}
      aria-hidden={decorativo || !svg ? true : undefined}
      // El SVG sale de nuestro motor y de coordenadas escritas a mano; no hay entrada del usuario.
      dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
    />
  );
}
