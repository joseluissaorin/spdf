/**
 * Un diálogo modal sobre <dialog>: el navegador ya atrapa el foco, cierra con
 * Escape y lo anuncia a los lectores de pantalla. Al cerrarse, el foco vuelve
 * a donde estaba.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { Cerrar } from './Iconos';
import { useIdioma } from '../i18n';

export function Dialogo({ titulo, abierto, alCerrar, children, pie, ancho }: {
  titulo: string; abierto: boolean; alCerrar: () => void; children: ReactNode; pie?: ReactNode; ancho?: number;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const { t } = useIdioma();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (abierto && !d.open) d.showModal();
    if (!abierto && d.open) d.close();
  }, [abierto]);
  return (
    <dialog ref={ref} onClose={alCerrar} aria-labelledby="dialogo-titulo" style={ancho ? { width: `min(${ancho}px, calc(100vw - 32px))` } : undefined}
      onClick={(e) => { if (e.target === ref.current) alCerrar(); }}>
      {abierto && (
        <>
          <div className="dialogo-cabeza">
            <h2 id="dialogo-titulo">{titulo}</h2>
            <button className="icono" onClick={alCerrar} aria-label={t('cerrar')}><Cerrar /></button>
          </div>
          <div className="dialogo-cuerpo">{children}</div>
          {pie && <div className="dialogo-pie">{pie}</div>}
        </>
      )}
    </dialog>
  );
}

export function Progreso({ hecho, total }: { hecho?: number; total?: number }) {
  const p = total ? Math.min(100, (100 * (hecho ?? 0)) / total) : null;
  return (
    <div className={`progreso${p == null ? ' indeterminado' : ''}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={p ?? undefined}>
      <i style={p != null ? { width: `${p}%` } : undefined} />
    </div>
  );
}
