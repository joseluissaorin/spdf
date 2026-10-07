/**
 * Preguntar al documento (opcional): Gemma 4 en este equipo o Gemini con la
 * clave del usuario. Cada afirmación aparece con la frase literal del SPDF que
 * la respalda, su cita corta y la probabilidad que le da el juez.
 */
import { useEffect, useState } from 'react';
import { useApp } from '../app/estado';
import { useIdioma } from '../i18n';
import type { MotorIA, ModeloCatalogo } from '../nucleo/nucleo';
import type { Resumen } from '../nucleo/tipos';
import { Cerrar } from '../componentes/Iconos';
import { Progreso } from '../componentes/Dialogo';
import { Boceto } from '../dibujo/BocetoReact';
import { preguntar, type Respuesta } from '../util/preguntar';

export function PanelPreguntar({ id, resumen, alCerrar, alIr }: { id: string; resumen: Resumen; alCerrar: () => void; alIr: (ord: number, f: string) => void }) {
  const { nucleo, lengua, ir } = useApp();
  const { t } = useIdioma();
  const [pregunta, setPregunta] = useState('');
  const [motor, setMotor] = useState<MotorIA>('local');
  const [modelos, setModelos] = useState<ModeloCatalogo[]>([]);
  const [clave, setClave] = useState('ninguna');
  const [fase, setFase] = useState<'buscar' | 'redactar' | 'verificar' | null>(null);
  const [tokens, setTokens] = useState(0);
  const [r, setR] = useState<Respuesta | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void nucleo.modelos().then(setModelos).catch(() => setModelos([]));
    void nucleo.estadoClave().then((c) => { setClave(c); if (c !== 'ninguna') setMotor((m) => m); });
  }, [nucleo]);
  const gen = modelos.find((m) => m.tipo === 'generate' && m.recomendado) ?? modelos.find((m) => m.tipo === 'generate');
  const listo = motor === 'prueba' || (motor === 'gemini' ? clave !== 'ninguna' : !!gen?.descargado);

  const enviar = async () => {
    if (!pregunta.trim()) return;
    setR(null); setError(null); setTokens(0);
    try {
      const res = await preguntar(nucleo, { ambito: id, pregunta, motor, lengua }, { fase: setFase, token: () => setTokens((n) => n + 1) });
      setR(res);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setFase(null); }
  };

  return (
    <aside className="panel" aria-labelledby="titulo-preguntar">
      <div className="panel-cabeza">
        <h2 id="titulo-preguntar">{t('preguntarTitulo')}</h2>
        <button className="icono" onClick={alCerrar} aria-label={t('cerrar')}><Cerrar /></button>
      </div>
      <div className="panel-cuerpo">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', gap: 10, alignItems: 'center', marginBottom: 12 }}>
          <p style={{ margin: 0, fontSize: 14.5 }} className="apagado">{t('preguntarTexto')}</p>
          <Boceto carga={() => import('../dibujo/dibujos/balanza').then((m) => m.balanza)} caja={[300, 240]} lengua={lengua} decorativo />
        </div>
        <form onSubmit={(e) => { e.preventDefault(); void enviar(); }} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label className="etiqueta" htmlFor="pregunta">{t('pregunta')}</label>
          <textarea id="pregunta" className="campo" rows={3} value={pregunta} onChange={(e) => setPregunta(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void enviar(); }} />
          <fieldset>
            <legend className="etiqueta">{t('motor')}</legend>
            {nucleo.capacidades.iaLocal && <label className="casilla"><input type="radio" name="motor-p" checked={motor === 'local'} onChange={() => setMotor('local')} />{t('motorGenerar')}{gen && !gen.descargado && <span className="apagado"> · {t('faltaModelo', { tam: '' }).replace(/\s*\(\)/, '')}</span>}</label>}
            <label className="casilla"><input type="radio" name="motor-p" checked={motor === 'gemini'} onChange={() => setMotor('gemini')} />{t('motorGemini')}{clave === 'ninguna' && <span className="apagado"> · {t('sinClave')}</span>}</label>
            {nucleo.capacidades.pruebas && <label className="casilla"><input type="radio" name="motor-p" checked={motor === 'prueba'} onChange={() => setMotor('prueba')} />{t('motorPrueba')}</label>}
          </fieldset>
          {!listo && (motor === 'gemini'
            ? <button type="button" className="boton chico" style={{ alignSelf: 'flex-start' }} onClick={() => ir({ vista: 'ajustes' })}>{t('faltaClave')}</button>
            : <button type="button" className="boton chico" style={{ alignSelf: 'flex-start' }} onClick={() => ir({ vista: 'ajustes' })}>{t('modelos')}</button>)}
          <button className="boton tinta" type="submit" disabled={!listo || !!fase || !pregunta.trim()} style={{ alignSelf: 'flex-start' }}>{t('enviar')}</button>
        </form>

        {fase && (
          <div role="status" style={{ marginTop: 16 }}>
            <Progreso />
            <p className="mono apagado">{fase === 'verificar' ? t('verificando') : t('pensando')}{tokens ? ` · ${tokens}` : ''}</p>
          </div>
        )}
        {error && <p className="aviso-busqueda" role="alert">{error}</p>}

        {r && (
          <div style={{ marginTop: 18 }} aria-live="polite">
            {r.aceptadas.length === 0 && <p>{t('sinRespuesta')}</p>}
            {r.aceptadas.map((a, i) => (
              <div key={i} className="afirmacion">
                <p>{a.texto}</p>
                <blockquote lang={resumen.document.language ?? undefined}>«{a.cita}»</blockquote>
                <div className="pie-af">
                  <span className="mono rojo">{a.pasaje.cita}</span>
                  <span className="medidor" title={t('respaldo', { p: Math.round(a.apoyo * 100) })}><i style={{ width: `${Math.round(a.apoyo * 100)}%` }} /></span>
                  <span className="mono apagado">{t('respaldo', { p: Math.round(a.apoyo * 100) })}</span>
                  {!a.literal && <span className="sello oro" title={t('citaLiteral')}>≈</span>}
                  <button className="boton fantasma chico" onClick={() => alIr(a.pasaje.unidad_ord, a.pasaje.fragment_id)}>{t('irAlPasaje')}</button>
                </div>
              </div>
            ))}
            {r.descartadas.length > 0 && (
              <details className="descartadas" style={{ marginTop: 12 }}>
                <summary>{t('descartadas', { n: r.descartadas.length })}</summary>
                {r.descartadas.map((a, i) => <p key={i} style={{ fontSize: 14 }}>{a.texto} <span className="sello">{a.motivo}</span></p>)}
              </details>
            )}
            <details style={{ marginTop: 12 }}>
              <summary>{t('pasajes')} ({r.pasajes.length})</summary>
              <ol className="resultados">
                {r.pasajes.map((p) => (
                  <li key={p.fragment_id}><button className="resultado" onClick={() => alIr(p.unidad_ord, p.fragment_id)}><span className="cita">{p.cita}</span><p className="fragmento">{p.texto}</p></button></li>
                ))}
              </ol>
            </details>
          </div>
        )}
      </div>
    </aside>
  );
}
