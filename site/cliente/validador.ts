/**
 * La entrada del validador: pequeña, para que la hoja cargue sin pagar
 * spdf-format ni SQLite. El inspector (inspector.ts, con spdf-format y SQLite
 * en WebAssembly) se descarga al soltar o elegir el primer fichero.
 */
type Inspector = typeof import('./inspector');
let inspector: Promise<Inspector> | null = null;
const cargar = () => (inspector ??= import('./inspector'));

const $ = <T extends Element = HTMLElement>(s: string) => document.querySelector(s) as T | null;
const raiz = $('.validador');
const T = JSON.parse($('#textos-validador')?.textContent ?? '{}') as Record<string, string>;
const resultado = $('#resultado')!;
const esc = (t: unknown) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function progreso(t: string) {
  resultado.innerHTML = `<p class="progreso" role="status">${esc(t)}</p>`;
}

async function procesar(bytes: Uint8Array, nombre: string) {
  const m = await cargar();
  await m.procesar(bytes, nombre);
}

async function desdeFichero(f: File) {
  progreso(T.leyendo ?? '…');
  const [bytes] = await Promise.all([f.arrayBuffer(), cargar()]);
  await procesar(new Uint8Array(bytes), f.name);
}

if (raiz && raiz.dataset.activo === '1') {
  const zona = $('#soltar')!;
  const input = $('#fichero') as HTMLInputElement;
  // Precarga el inspector en cuanto se acerca el ratón o el foco: así el primer fichero no espera.
  for (const ev of ['pointerenter', 'focusin', 'dragenter']) zona.addEventListener(ev, () => void cargar(), { once: true });
  input.addEventListener('change', () => { const f = input.files?.[0]; if (f) void desdeFichero(f); input.value = ''; });
  for (const ev of ['dragenter', 'dragover']) {
    (ev === 'dragover' ? document : zona).addEventListener(ev, (e) => { e.preventDefault(); zona.classList.add('encima'); });
  }
  for (const ev of ['dragleave', 'dragend']) zona.addEventListener(ev, () => zona.classList.remove('encima'));
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    zona.classList.remove('encima');
    const f = (e as DragEvent).dataTransfer?.files?.[0];
    if (f) void desdeFichero(f);
  });
  for (const b of document.querySelectorAll<HTMLButtonElement>('.muestra')) {
    b.disabled = false;
    b.addEventListener('pointerenter', () => void cargar(), { once: true });
    b.addEventListener('click', async () => {
      b.disabled = true;
      progreso(T.leyendo ?? '…');
      try {
        const [r] = await Promise.all([fetch(b.dataset.url!), cargar()]);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        await procesar(new Uint8Array(await r.arrayBuffer()), b.dataset.url!.split('/').pop()!);
      } catch (e) {
        resultado.innerHTML = `<p class="aviso">${esc(T.errorFetch)} ${esc((e as Error).message)}</p>`;
      } finally {
        b.disabled = false;
      }
    });
  }
  // Una muestra por la dirección: /validator#muestra=spdf-in-five-pages.spdf
  const m = /muestra=([\w.-]+)/.exec(location.hash);
  if (m) document.querySelector<HTMLButtonElement>(`.muestra[data-url$="/${m[1]}"]`)?.click();
}
