/**
 * Guion de pruebas para la app nativa (SPDF_GUION=/ruta/guion.json): la propia
 * interfaz ejecuta los pasos pulsando sus botones y escribiendo en sus campos,
 * como una persona, y apunta cada resultado en medidas.jsonl (comando `medida`).
 * Sirve para probar de punta a punta la app de escritorio sin robar el foco
 * (una vista web en segundo plano no recibe teclas ni clics de fuera).
 *
 * Pasos: {"descargar": id} · {"abrir": "/ruta.spdf"} · {"revectorizar": {"motor","dims"}}
 *        {"buscar": {"consulta","modo"}} · {"preguntar": {"pregunta","motor"}} · {"esperar": ms}
 */
import type { Nucleo } from '../nucleo/nucleo';

type Paso =
  | { descargar: string }
  | { abrir: string }
  | { revectorizar: { motor: string; dims: number } }
  | { buscar: { consulta: string; modo: 'lexica' | 'semantica' | 'hibrida' } }
  | { preguntar: { pregunta: string; motor: string } }
  | { esperar: number };

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function esperar<T>(f: () => T | null | undefined | false, ms = 600_000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = f();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error('tiempo agotado');
    await dormir(150);
  }
}
const q = <E extends Element = HTMLElement>(s: string) => document.querySelector<E>(s);
const boton = (texto: RegExp | string, dentro: ParentNode = document) =>
  [...dentro.querySelectorAll<HTMLElement>('button, [role=menuitem], [role=radio]')].find((b) =>
    typeof texto === 'string' ? (b.getAttribute('aria-label') ?? b.textContent ?? '').trim() === texto : texto.test(b.getAttribute('aria-label') ?? b.textContent ?? ''));
/** Escribe en un campo controlado por React (el setter nativo y el evento input). */
function escribir(el: HTMLInputElement | HTMLTextAreaElement, valor: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, valor);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

export async function ejecutarGuion(nucleo: Nucleo, pasos: Paso[], apuntar: (nombre: string, ms: number, detalle: string) => void) {
  for (const p of pasos) {
    const t0 = performance.now();
    const fin = (nombre: string, detalle: string) => apuntar(`guion:${nombre}`, performance.now() - t0, detalle);
    try {
      if ('esperar' in p) { await dormir(p.esperar); continue; }
      if ('descargar' in p) {
        let ultimo = 0;
        await nucleo.descargarModelo(p.descargar, (x) => { if (performance.now() - ultimo > 5000) { ultimo = performance.now(); apuntar('guion:descargando', x.hecho, `${p.descargar} ${x.hecho}/${x.total}`); } });
        fin('descargar', p.descargar);
      } else if ('abrir' in p) {
        const [r] = await nucleo.importar([p.abrir]);
        if (!r?.ok || !r.entrada) throw new Error(r?.error ?? 'no se pudo importar');
        location.hash = `#/leer/${r.entrada.id}`;
        await esperar(() => q('.hoja, .transcripcion article'));
        fin('abrir', `${r.entrada.titulo} · ${r.entrada.unidades} unidades`);
      } else if ('revectorizar' in p) {
        boton('Exportar')!.click();
        await esperar(() => boton('Revectorizar'))!.then((b) => b.click());
        const d = await esperar(() => q('dialog[open]'));
        const etiqueta = p.revectorizar.motor === 'local' ? /en este equipo|on this device/ : p.revectorizar.motor === 'gemini' ? /Gemini/ : /pruebas|Test model/;
        const radio = [...d.querySelectorAll<HTMLLabelElement>('label.casilla')].find((l) => etiqueta.test(l.textContent ?? ''))?.querySelector('input');
        radio?.click();
        await dormir(200);
        boton(String(p.revectorizar.dims), d)?.click();
        await dormir(200);
        const empezar = await esperar(() => { const b = boton(/^(Empezar|Start)$/, d) as HTMLButtonElement | undefined; return b && !b.disabled ? b : null; }, 30_000);
        empezar.click();
        await esperar(() => !q('dialog[open]') || q('dialog[open] [role=alert]'), 1_800_000);
        const alerta = q('dialog[open] [role=alert]');
        if (alerta) throw new Error(alerta.textContent ?? 'error');
        await esperar(() => q('.hoja, .transcripcion article'));
        fin('revectorizar', `${p.revectorizar.motor} @${p.revectorizar.dims}`);
      } else if ('buscar' in p) {
        if (!q('#q')) { boton('Buscar')!.click(); await esperar(() => q('#q')); }
        const modos = { lexica: /Léxica|Lexical/, semantica: /Semántica|Semantic/, hibrida: /Híbrida|Hybrid/ };
        boton(modos[p.buscar.modo], q('.panel')!)?.click();
        escribir(q<HTMLInputElement>('#q')!, p.buscar.consulta);
        q<HTMLFormElement>('.panel form[role=search]')!.requestSubmit();
        await esperar(() => /\d+ (resultados|results)/.test(q('.panel .susurro')?.textContent ?? '') && q('.panel .susurro')?.textContent);
        await dormir(400);
        const aviso = q('.aviso-busqueda')?.textContent ?? '';
        const primero = q('.resultado');
        fin('buscar', `${p.buscar.modo} «${p.buscar.consulta}»: ${q('.panel .susurro')?.textContent} · ${primero?.querySelector('.cita')?.textContent ?? ''} ${[...(primero?.querySelectorAll('.via .sello') ?? [])].map((x) => x.textContent).join('+')} ${aviso ? `· aviso: ${aviso}` : ''}`);
      } else if ('preguntar' in p) {
        if (q('.panel')) boton(/^(Cerrar|Close)$/, q('.panel')!)?.click();
        await dormir(200);
        boton(/^(Preguntar|Ask)$/)!.click();
        const panel = await esperar(() => q('.panel'));
        const etiqueta = p.preguntar.motor === 'local' ? /Gemma 4/ : p.preguntar.motor === 'gemini' ? /Gemini/ : /pruebas|Test model/;
        [...panel.querySelectorAll<HTMLLabelElement>('label.casilla')].find((l) => etiqueta.test(l.textContent ?? ''))?.querySelector('input')?.click();
        escribir(q<HTMLTextAreaElement>('#pregunta')!, p.preguntar.pregunta);
        await dormir(200);
        q<HTMLFormElement>('.panel form')!.requestSubmit();
        await esperar(() => q('.afirmacion, .panel [role=alert]') || [...panel.querySelectorAll('p')].find((x) => /no contiene nada|contains nothing/.test(x.textContent ?? '')), 1_800_000);
        const af = [...document.querySelectorAll('.afirmacion')].slice(0, 3).map((a) => `${a.querySelector('p')?.textContent} ${a.querySelector('blockquote')?.textContent} ${a.querySelector('.mono.rojo')?.textContent} ${a.querySelector('.mono.apagado')?.textContent}`);
        const desc = [...document.querySelectorAll('.descartadas p')].map((x) => x.textContent).join(' | ');
        const bruto = q('[data-bruto]')?.textContent?.slice(0, 600) ?? '';
        fin('preguntar', `«${p.preguntar.pregunta}» → ${af.length ? af.join(' | ') : q('.panel [role=alert]')?.textContent ?? 'sin respuesta con respaldo'}${desc ? ` · descartadas: ${desc}` : ''} · bruto: ${bruto}`);
      }
    } catch (e) {
      fin('error', `${JSON.stringify(p)}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  apuntar('guion:fin', 0, '');
}
