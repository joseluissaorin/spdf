/**
 * Un canal mínimo de llamadas entre el hilo principal y el Worker:
 *   principal → worker  {id, m, a}
 *   worker → principal  {id, ok: true, v} | {id, ok: false, e} | {id, ev}
 * `ev` son eventos intermedios (progreso, tokens) de una llamada en curso.
 * Los Uint8Array y Float32Array viajan transferidos cuando se puede.
 */
export type Evento = unknown;

interface Pendiente { ok: (v: unknown) => void; ko: (e: Error) => void; ev?: (e: Evento) => void }

export class Canal {
  #w: Worker;
  #n = 0;
  #pend = new Map<number, Pendiente>();
  constructor(w: Worker) {
    this.#w = w;
    w.addEventListener('message', (e: MessageEvent) => {
      const d = e.data as { id: number; ok?: boolean; v?: unknown; e?: string; ev?: Evento };
      const p = this.#pend.get(d.id);
      if (!p) return;
      if ('ev' in d) { p.ev?.(d.ev); return; }
      this.#pend.delete(d.id);
      if (d.ok) p.ok(d.v); else p.ko(new Error(d.e ?? 'Error en el worker'));
    });
    w.addEventListener('error', (e) => {
      for (const p of this.#pend.values()) p.ko(new Error(e.message || 'El worker se ha caído'));
      this.#pend.clear();
    });
  }
  llamar<T>(m: string, a: unknown[] = [], ev?: (e: Evento) => void, transferir: Transferable[] = []): Promise<T> {
    const id = ++this.#n;
    return new Promise<T>((ok, ko) => {
      this.#pend.set(id, { ok: ok as (v: unknown) => void, ko, ev });
      this.#w.postMessage({ id, m, a }, transferir);
    });
  }
}

/** Lado del Worker: atiende las llamadas con un objeto de métodos. */
export function atender(metodos: Record<string, (...a: any[]) => unknown>): void {
  const ctx = self as unknown as DedicatedWorkerGlobalScope;
  ctx.addEventListener('message', async (e: MessageEvent) => {
    const { id, m, a } = e.data as { id: number; m: string; a: unknown[] };
    const emitir = (ev: Evento) => ctx.postMessage({ id, ev });
    try {
      const f = metodos[m];
      if (!f) throw new Error(`Método desconocido: ${m}`);
      const v = await f(...(a ?? []), emitir);
      ctx.postMessage({ id, ok: true, v }, transferibles(v));
    } catch (err) {
      ctx.postMessage({ id, ok: false, e: err instanceof Error ? err.message : String(err) });
    }
  });
}

function transferibles(v: unknown): Transferable[] {
  if (v instanceof Uint8Array || v instanceof Float32Array) return v.byteOffset === 0 && v.byteLength === v.buffer.byteLength ? [v.buffer as ArrayBuffer] : [];
  if (v && typeof v === 'object' && 'data' in (v as object)) return transferibles((v as { data: unknown }).data);
  return [];
}
