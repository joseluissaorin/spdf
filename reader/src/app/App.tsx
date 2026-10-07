/**
 * El armazón: la vista de la ruta, los avisos, la zona de soltar ficheros y los
 * ficheros que llegan «abiertos con» el lector (Tauri: doble clic en un .spdf).
 */
import { lazy, Suspense, useEffect, useState } from 'react';
import { useApp } from './estado';
import { useIdioma } from '../i18n';
import { Biblioteca } from '../vistas/Biblioteca';
import { Cerrar } from '../componentes/Iconos';
import { useImportar } from '../vistas/importar';

const Lector = lazy(() => import('../vistas/Lector').then((m) => ({ default: m.Lector })));
const Ajustes = lazy(() => import('../vistas/Ajustes').then((m) => ({ default: m.Ajustes })));

export function App() {
  const { ruta, avisos, quitarAviso, nucleo } = useApp();
  const { t } = useIdioma();
  const importar = useImportar();
  const [arrastrando, setArrastrando] = useState(false);

  useEffect(() => {
    performance.mark('spdf:interfaz');
    performance.measure('spdf:arranque', 'spdf:inicio', 'spdf:interfaz');
  }, []);

  // Arrastrar y soltar en cualquier pantalla.
  useEffect(() => {
    let c = 0;
    const tieneFicheros = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes('Files');
    const entra = (e: DragEvent) => { if (!tieneFicheros(e)) return; e.preventDefault(); c++; setArrastrando(true); };
    const sale = () => { c = Math.max(0, c - 1); if (!c) setArrastrando(false); };
    const sobre = (e: DragEvent) => { if (tieneFicheros(e)) e.preventDefault(); };
    const suelta = (e: DragEvent) => {
      if (!tieneFicheros(e)) return;
      e.preventDefault(); c = 0; setArrastrando(false);
      const fs = [...(e.dataTransfer?.files ?? [])];
      if (fs.length) void importar(fs);
    };
    addEventListener('dragenter', entra); addEventListener('dragleave', sale);
    addEventListener('dragover', sobre); addEventListener('drop', suelta);
    return () => { removeEventListener('dragenter', entra); removeEventListener('dragleave', sale); removeEventListener('dragover', sobre); removeEventListener('drop', suelta); };
  }, [importar]);

  // Ficheros abiertos con el lector desde el sistema (solo Tauri).
  useEffect(() => {
    const n = nucleo as { alAbrirFicheros?: (f: (rutas: string[]) => void) => () => void };
    return n.alAbrirFicheros?.((rutas) => void importar(rutas, { abrir: true }));
  }, [nucleo, importar]);

  return (
    <div className="app">
      <a className="saltar" href="#contenido">{t('saltar')}</a>
      <Suspense fallback={<div className="vacio" role="status">{t('cargando')}</div>}>
        {ruta.vista === 'leer' ? <Lector key={ruta.id} /> : ruta.vista === 'ajustes' ? <Ajustes /> : <Biblioteca />}
      </Suspense>
      <div className={`zona-soltar${arrastrando ? ' activa' : ''}`} aria-hidden="true"><p>{t('soltarAqui')}</p></div>
      <div className="avisos" role="status" aria-live="polite">
        {avisos.map((a) => (
          <div key={a.id} className={`aviso${a.tipo === 'error' ? ' error' : ''}`}>
            <span>{a.texto}</span>
            {a.accion && <button className="boton chico" style={{ borderColor: 'currentColor', color: 'inherit' }} onClick={() => { a.accion!.hacer(); quitarAviso(a.id); }}>{a.accion.texto}</button>}
            <button className="icono" style={{ width: 26, height: 26 }} aria-label={t('cerrar')} onClick={() => quitarAviso(a.id)}><Cerrar /></button>
          </div>
        ))}
      </div>
    </div>
  );
}
