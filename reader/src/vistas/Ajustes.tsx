/**
 * Ajustes: idioma, aspecto, tamaño del texto, modelos locales (bajo demanda,
 * con su tamaño), la clave de Gemini (llavero del sistema en escritorio y
 * móvil; en la web, solo en memoria salvo que se pida recordarla) y la
 * declaración de privacidad.
 */
import { useEffect, useState } from 'react';
import { useApp } from '../app/estado';
import { useIdioma, tamano } from '../i18n';
import type { ModeloCatalogo, Progreso as P, EstadoClave } from '../nucleo/nucleo';
import { Atras, Papelera } from '../componentes/Iconos';
import { Progreso } from '../componentes/Dialogo';

export function Ajustes() {
  const { prefs, cambiarPrefs, nucleo, ir, avisar, lengua } = useApp();
  const { t } = useIdioma();
  const [modelos, setModelos] = useState<ModeloCatalogo[] | null>(null);
  const [descargas, setDescargas] = useState<Record<string, P>>({});
  const [clave, setClave] = useState('');
  const [estado, setEstado] = useState<EstadoClave>('ninguna');
  const [persistir, setPersistir] = useState(nucleo.plataforma !== 'web');
  const [instalar, setInstalar] = useState<(Event & { prompt: () => void }) | null>(null);

  useEffect(() => {
    void nucleo.modelos().then(setModelos).catch(() => setModelos([]));
    void nucleo.estadoClave().then(setEstado);
    const f = (e: Event) => { e.preventDefault(); setInstalar(e as Event & { prompt: () => void }); };
    addEventListener('beforeinstallprompt', f);
    return () => removeEventListener('beforeinstallprompt', f);
  }, [nucleo]);

  const descargar = async (m: ModeloCatalogo) => {
    setDescargas((d) => ({ ...d, [m.id]: { fase: 'descargar', hecho: 0, total: m.bytes } }));
    try {
      await nucleo.descargarModelo(m.id, (p) => setDescargas((d) => ({ ...d, [m.id]: p })));
      setModelos(await nucleo.modelos());
    } catch (e) { avisar(String(e instanceof Error ? e.message : e), { tipo: 'error' }); }
    finally { setDescargas((d) => { const n = { ...d }; delete n[m.id]; return n; }); }
  };

  const web = nucleo.plataforma === 'web';
  return (
    <>
      <header className="barra">
        <button className="icono" onClick={() => ir({ vista: 'biblioteca' })} aria-label={t('volver')}><Atras /></button>
        <span className="separa" />
      </header>
      <main className="ajustes" id="contenido">
        <div>
          <h1>{t('ajustes')}</h1>

          <section>
            <h2>{t('idioma')}</h2>
            <div className="segmentado" role="group" aria-label={t('idioma')}>
              <button aria-pressed={prefs.idioma === 'sistema'} onClick={() => cambiarPrefs({ idioma: 'sistema' })}>{t('idiomaSistema')}</button>
              <button aria-pressed={prefs.idioma === 'es'} onClick={() => cambiarPrefs({ idioma: 'es' })} lang="es">Español</button>
              <button aria-pressed={prefs.idioma === 'en'} onClick={() => cambiarPrefs({ idioma: 'en' })} lang="en">English</button>
            </div>
          </section>

          <section>
            <h2>{t('tema')}</h2>
            <div>
              <div className="segmentado" role="group" aria-label={t('tema')}>
                <button aria-pressed={prefs.tema === 'sistema'} onClick={() => cambiarPrefs({ tema: 'sistema' })}>{t('temaSistema')}</button>
                <button aria-pressed={prefs.tema === 'claro'} onClick={() => cambiarPrefs({ tema: 'claro' })}>{t('temaClaro')}</button>
                <button aria-pressed={prefs.tema === 'oscuro'} onClick={() => cambiarPrefs({ tema: 'oscuro' })}>{t('temaOscuro')}</button>
              </div>
              <label className="etiqueta" htmlFor="tam" style={{ marginTop: 8 }}>{t('tamTexto')}: {prefs.tamTexto} px</label>
              <input id="tam" type="range" min={15} max={28} step={1} value={prefs.tamTexto} onChange={(e) => cambiarPrefs({ tamTexto: Number(e.target.value) })} style={{ accentColor: 'var(--rojo)', maxWidth: 320 }} />
            </div>
          </section>

          <section>
            <h2>{t('modelos')}</h2>
            <div>
              <p style={{ margin: 0 }}>{t('modelosTexto')}</p>
              {!modelos && <Progreso />}
              {modelos?.map((m) => {
                const d = descargas[m.id];
                return (
                  <div key={m.id} className="modelo">
                    <div>
                      <strong style={{ fontWeight: 'normal', fontSize: 17 }}>{m.nombre}</strong>
                      <div className="datos">
                        <span className="sello">{m.tipo}</span>
                        <span className="mono apagado">{tamano(m.bytes, lengua)}</span>
                        <span className="mono apagado">{t('licencia', { l: m.licencia })}</span>
                        <span className="mono apagado">{m.motor}</span>
                        {m.recomendado && <span className="sello azul">{t('recomendado')}</span>}
                      </div>
                    </div>
                    {m.descargado
                      ? <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}><span className="sello azul">{t('descargado')}</span>
                          <button className="icono" aria-label={`${t('borrar')} ${m.nombre}`} onClick={async () => { await nucleo.borrarModelo(m.id); setModelos(await nucleo.modelos()); }}><Papelera /></button></div>
                      : <button className="boton chico" disabled={!!d} onClick={() => descargar(m)}>{t('descargar', { tam: tamano(m.bytes, lengua) })}</button>}
                    {d && <div style={{ gridColumn: '1 / -1' }}><Progreso hecho={d.hecho} total={d.total} /><span className="mono apagado">{t('descargando', { p: d.total ? Math.round((100 * d.hecho) / d.total) : 0 })}</span></div>}
                  </div>
                );
              })}
            </div>
          </section>

          <section>
            <h2>{t('claveGemini')}</h2>
            <form onSubmit={async (e) => {
              e.preventDefault();
              if (!clave.trim()) return;
              await nucleo.guardarClave(clave.trim(), persistir);
              setClave('');
              setEstado(await nucleo.estadoClave());
            }}>
              <p style={{ margin: 0 }}>{t('claveGeminiTexto')}</p>
              {web && <p className="apagado" style={{ margin: 0, fontSize: 14 }}>{t('claveWebMemoria')}</p>}
              <label className="oculto-visual" htmlFor="clave">{t('claveGemini')}</label>
              <input id="clave" className="campo" type="password" autoComplete="off" spellCheck={false} value={clave} onChange={(e) => setClave(e.target.value)} placeholder="AIza…" style={{ maxWidth: 420 }} />
              {(nucleo.capacidades.llavero || web) && (
                <label className="casilla"><input type="checkbox" checked={persistir} onChange={(e) => setPersistir(e.target.checked)} />{web ? t('recordarClave') : t('guardarLlavero')}</label>
              )}
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <button className="boton tinta" type="submit" disabled={!clave.trim()}>{t('guardar')}</button>
                {estado !== 'ninguna' && <button className="boton" type="button" onClick={async () => { await nucleo.borrarClave(); setEstado('ninguna'); }}>{t('borrar')}</button>}
                <span className="mono apagado" role="status">{estado === 'llavero' ? t('claveGuardada') : estado === 'memoria' ? t('claveMemoria') : t('sinClave')}</span>
              </div>
            </form>
          </section>

          <section>
            <h2>{t('privacidadTitulo')}</h2>
            <p style={{ margin: 0 }}>{t('privacidadTexto')}</p>
          </section>

          <section>
            <h2>{t('atajos')}</h2>
            <div className="atajos">
              <span><kbd>←</kbd> <kbd>→</kbd></span><span>{t('atajoPaginas')}</span>
              <span><kbd>g</kbd></span><span>{t('atajoIr')}</span>
              <span><kbd>/</kbd></span><span>{t('atajoBuscar')}</span>
              <span><kbd>c</kbd></span><span>{t('atajoCitar')}</span>
              <span><kbd>f</kbd> <kbd>i</kbd></span><span>{t('atajoFicha')}</span>
              <span><kbd>v</kbd></span><span>{t('atajoVista')}</span>
              <span><kbd>n</kbd> <kbd>⇧N</kbd></span><span>{t('atajoResultados')}</span>
              <span><kbd>?</kbd></span><span>{t('atajoAyuda')}</span>
            </div>
          </section>

          <section>
            <h2>{t('acerca')}</h2>
            <div>
              <p style={{ margin: 0 }}>{t('acercaTexto', { v: __VERSION__ })}</p>
              <p className="mono apagado" style={{ margin: 0 }}>{nucleo.plataforma} · {__DESTINO__}{nucleo.capacidades.webgpu ? ' · WebGPU' : ''}</p>
              {instalar && <button className="boton" style={{ alignSelf: 'flex-start' }} onClick={() => instalar.prompt()}>{t('instalar')}</button>}
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
