/**
 * Revectorizar: los vectores de cada fragmento con EmbeddingGemma 2 en este
 * equipo (eligiendo el recorte Matryoshka) o con Gemini y la clave del usuario.
 * Se escriben en una copia (por defecto) o en el mismo fichero si se pide; el
 * resultado se valida antes de guardarlo: siempre SPDF 5.0 válido.
 */
import { useEffect, useState } from 'react';
import { useApp } from '../app/estado';
import { useIdioma, tamano } from '../i18n';
import type { EntradaBiblioteca, ModeloCatalogo, MotorIA, Progreso as P } from '../nucleo/nucleo';
import type { Resumen } from '../nucleo/tipos';
import { Dialogo, Progreso } from '../componentes/Dialogo';
import { Boceto } from '../dibujo/BocetoReact';

export function DialogoRevectorizar({ id, resumen, alCerrar, alTerminar }: { id: string; resumen: Resumen; alCerrar: () => void; alTerminar: (e: EntradaBiblioteca) => void }) {
  const { nucleo, lengua, avisar, ir } = useApp();
  const { t } = useIdioma();
  const [modelos, setModelos] = useState<ModeloCatalogo[] | null>(null);
  const [clave, setClave] = useState<string>('ninguna');
  const [motor, setMotor] = useState<MotorIA>('local');
  const [dims, setDims] = useState(768);
  const [destino, setDestino] = useState<'copia' | 'fichero'>('copia');
  const [progreso, setProgreso] = useState<P | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [descarga, setDescarga] = useState<P | null>(null);

  useEffect(() => {
    void nucleo.modelos().then(setModelos).catch(() => setModelos([]));
    void nucleo.estadoClave().then(setClave);
  }, [nucleo]);

  const embed = modelos?.filter((m) => m.tipo === 'embed') ?? [];
  const modelo = embed.find((m) => m.recomendado) ?? embed[0];
  const opcionesDims = motor === 'gemini' ? [3072, 1536, 768] : [768, 512, 256, 128];
  useEffect(() => { if (!opcionesDims.includes(dims)) setDims(opcionesDims[motor === 'gemini' ? 1 : 0]); }, [motor]); // eslint-disable-line react-hooks/exhaustive-deps

  const listo = motor === 'prueba' || (motor === 'gemini' ? clave !== 'ninguna' : !!modelo?.descargado);

  const empezar = async () => {
    setError(null);
    setProgreso({ fase: 'vectores', hecho: 0, total: resumen.fragmentos });
    try {
      const e = await nucleo.revectorizar(id, { motor, modelo: motor === 'local' ? modelo?.id : undefined, dims, destino }, setProgreso);
      avisar(t('revectorizado', { espacio: e.espacios.join(', ') }));
      alTerminar(e);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setProgreso(null);
    }
  };

  const descargar = async () => {
    if (!modelo) return;
    setDescarga({ fase: 'descargar', hecho: 0, total: modelo.bytes });
    try {
      await nucleo.descargarModelo(modelo.id, setDescarga);
      setModelos(await nucleo.modelos());
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setDescarga(null); }
  };

  const ocupado = !!progreso || !!descarga;
  return (
    <Dialogo titulo={t('revectorizarTitulo')} abierto alCerrar={() => !ocupado && alCerrar()} ancho={600}
      pie={<>
        <button className="boton" onClick={alCerrar} disabled={ocupado}>{t('cancelar')}</button>
        <button className="boton tinta" onClick={empezar} disabled={!listo || ocupado}>{t('empezar')}</button>
      </>}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 150px', gap: 12, alignItems: 'center' }}>
        <p style={{ margin: 0 }}>{t('revectorizarTexto')}</p>
        <Boceto carga={() => import('../dibujo/dibujos/matrioskas').then((m) => m.matrioskas)} caja={[300, 220]} lengua={lengua} decorativo />
      </div>
      <fieldset disabled={ocupado}>
        <legend className="etiqueta">{t('motor')}</legend>
        {nucleo.capacidades.iaLocal && (
          <label className="casilla"><input type="radio" name="motor" checked={motor === 'local'} onChange={() => setMotor('local')} />
            <span>{t('motorLocal')}{modelo && <span className="apagado"> · {modelo.descargado ? t('descargado') : tamano(modelo.bytes, lengua)}</span>}</span></label>
        )}
        <label className="casilla"><input type="radio" name="motor" checked={motor === 'gemini'} onChange={() => setMotor('gemini')} />
          <span>{t('motorGemini')}{clave === 'ninguna' && <span className="apagado"> · {t('sinClave')}</span>}</span></label>
        {nucleo.capacidades.pruebas && (
          <label className="casilla"><input type="radio" name="motor" checked={motor === 'prueba'} onChange={() => setMotor('prueba')} /><span>{t('motorPrueba')}</span></label>
        )}
        {motor === 'local' && modelo && !modelo.descargado && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <span className="apagado">{t('faltaModelo', { tam: tamano(modelo.bytes, lengua) })}</span>
            <button className="boton chico" onClick={descargar} disabled={!!descarga}>{t('descargar', { tam: tamano(modelo.bytes, lengua) })}</button>
          </div>
        )}
        {motor === 'local' && !modelo && modelos && <span className="apagado">{t('faltaModelo', { tam: '?' })}</span>}
        {motor === 'gemini' && clave === 'ninguna' && <button className="boton chico" style={{ alignSelf: 'flex-start' }} onClick={() => { alCerrar(); ir({ vista: 'ajustes' }); }}>{t('faltaClave')}</button>}
        {descarga && <><Progreso hecho={descarga.hecho} total={descarga.total} /><span className="mono apagado">{t('descargando', { p: descarga.total ? Math.round((100 * descarga.hecho) / descarga.total) : 0 })}</span></>}
      </fieldset>
      <fieldset disabled={ocupado}>
        <legend className="etiqueta">{t('recorte')}</legend>
        <div className="segmentado" role="radiogroup" aria-label={t('recorte')}>
          {opcionesDims.map((d) => <button key={d} role="radio" aria-checked={dims === d} aria-pressed={dims === d} onClick={() => setDims(d)}>{d}</button>)}
        </div>
        <span className="apagado" style={{ fontSize: 14 }}>{t('recorteTexto')}</span>
      </fieldset>
      <fieldset disabled={ocupado}>
        <legend className="etiqueta">{t('destino')}</legend>
        <label className="casilla"><input type="radio" name="destino" checked={destino === 'copia'} onChange={() => setDestino('copia')} />{t('destinoCopia')}</label>
        <label className="casilla"><input type="radio" name="destino" checked={destino === 'fichero'} onChange={() => setDestino('fichero')} />{t('destinoFichero')}</label>
        {destino === 'fichero' && <span className="apagado" style={{ fontSize: 14 }}>{t('destinoFicheroAviso')}</span>}
      </fieldset>
      {progreso && (
        <div role="status">
          <Progreso hecho={progreso.hecho} total={progreso.total} />
          <p className="mono apagado" style={{ marginTop: 6 }}>
            {progreso.fase === 'vectores' ? t('progresoVectores', { hecho: progreso.hecho, total: progreso.total }) : t('progresoEscribir')}
          </p>
        </div>
      )}
      {error && <p className="aviso-busqueda" role="alert">{error}</p>}
    </Dialogo>
  );
}
