/**
 * El facsímil: la imagen de la página tal como se escaneó (o la miniatura, si el
 * SPDF no trae la página entera). Las imágenes remotas no se cargan solas: sin
 * conexión por defecto.
 */
import { useEffect, useState } from 'react';
import { useApp } from '../app/estado';
import { useIdioma } from '../i18n';
import type { Region, Unidad } from '../nucleo/tipos';
import { Mas, Menos } from '../componentes/Iconos';

export function Facsimil({ id, unidad, region }: { id: string; unidad: Unidad | null; region?: Region | null }) {
  const { nucleo } = useApp();
  const { t } = useIdioma();
  const [url, setUrl] = useState<string | null>(null);
  const [estado, setEstado] = useState<'cargando' | 'listo' | 'sin' | 'remota'>('cargando');
  const [permitir, setPermitir] = useState(false);
  const [zoom, setZoom] = useState(1);
  const ref = unidad?.image ?? unidad?.thumbnail ?? null;
  const remota = !!ref && /^https?:/i.test(ref);

  useEffect(() => {
    let vivo = true;
    setUrl(null);
    if (!unidad || !ref) { setEstado('sin'); return; }
    if (remota && !permitir) { setEstado('remota'); return; }
    setEstado('cargando');
    (async () => {
      let u = await nucleo.recurso(id, ref);
      if (!u && unidad.thumbnail && unidad.thumbnail !== ref) u = await nucleo.recurso(id, unidad.thumbnail);
      if (!vivo) return;
      setUrl(u);
      setEstado(u ? 'listo' : 'sin');
    })().catch(() => vivo && setEstado('sin'));
    return () => { vivo = false; };
  }, [id, unidad, ref, remota, permitir, nucleo]);

  const host = remota ? new URL(ref!).host : '';
  return (
    <section className="facsimil" aria-label={t('facsimil')}>
      {estado === 'listo' && url && (
        <>
          <div className="zoom">
            <button className="icono" onClick={() => setZoom((z) => Math.min(3, z + 0.25))} aria-label={t('ampliar')}><Mas /></button>
            <button className="icono" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))} aria-label={t('reducir')}><Menos /></button>
          </div>
          <div className="lienzo" style={{ ['--zoom' as string]: zoom }}>
            <img src={url} alt={`${t('facsimil')}: ${unidad?.printed ? `p. ${unidad.printed}` : t('paginaFisica', { n: unidad?.ord ?? 0, total: '' }).trim()}`} decoding="async" />
            {region && <div className="region" style={{ left: `${region.x * 100}%`, top: `${region.y * 100}%`, width: `${region.w * 100}%`, height: `${region.h * 100}%` }} />}
          </div>
        </>
      )}
      {estado === 'cargando' && <div className="vacio-img" role="status">{t('cargando')}</div>}
      {estado === 'sin' && <p className="vacio-img">{t('sinImagen')}</p>}
      {estado === 'remota' && (
        <div className="vacio-img">
          <p>{t('imagenRemota', { host })}</p>
          <button className="boton chico" onClick={() => setPermitir(true)}>{t('cargarRemota', { host })}</button>
        </div>
      )}
    </section>
  );
}
