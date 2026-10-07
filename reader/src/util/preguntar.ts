/**
 * Preguntar al documento sin dejar que el modelo invente citas.
 *
 *  1. Se recuperan los pasajes (búsqueda híbrida; léxica si no hay vectores).
 *  2. El modelo (Gemma 4 local o Gemini) responde en JSON: cada afirmación
 *     señala su pasaje y copia de él la frase que la respalda.
 *  3. La frase se busca, literal, en el texto del pasaje. Si no está, se
 *     sustituye por la frase del pasaje que más se le parece (si se parece de
 *     verdad) o la afirmación se descarta. Lo que se enseña entre comillas es
 *     SIEMPRE texto del SPDF, con su ancla y su cita corta.
 *  4. El juez (el mismo motor, por logits en local) estima si el pasaje
 *     respalda la afirmación; por debajo de 0,5 se descarta.
 */
import type { Nucleo, MotorIA } from '../nucleo/nucleo';
import type { Acierto, Lengua } from '../nucleo/tipos';

export interface Afirmacion {
  texto: string;
  pasaje: Acierto;
  cita: string;          // frase literal del pasaje
  literal: boolean;      // el modelo la copió bien (si no, se ha tomado la frase más parecida)
  apoyo: number;
  etiqueta: string;
  motivo?: 'sin-pasaje' | 'cita-inventada' | 'sin-respaldo';
}

export interface Respuesta { aceptadas: Afirmacion[]; descartadas: Afirmacion[]; pasajes: Acierto[]; bruto?: string }

const UMBRAL = 0.5;

function instrucciones(l: Lengua): string {
  return l === 'es'
    ? 'Eres un asistente de lectura académica. Responde a la PREGUNTA usando SOLO los PASAJES numerados. Cada afirmación debe apoyarse en un único pasaje y copiar de él, LITERALMENTE y sin cambiar una letra, la frase que la respalda. No añadas nada que no esté en los pasajes. Devuelve SOLO JSON con esta forma: {"respuesta":[{"afirmacion":"…","pasaje":"P1","cita_literal":"…"}]}. Si los pasajes no responden a la pregunta, devuelve {"respuesta":[]}. Escribe las afirmaciones en la misma lengua que la PREGUNTA.'
    : 'You are an academic reading assistant. Answer the QUESTION using ONLY the numbered PASSAGES. Each claim must rest on a single passage and copy from it, VERBATIM and without changing a letter, the sentence that supports it. Add nothing that is not in the passages. Return ONLY JSON shaped like: {"respuesta":[{"afirmacion":"…","pasaje":"P1","cita_literal":"…"}]}. If the passages do not answer the question, return {"respuesta":[]}. Write the claims in the same language as the QUESTION.';
}

export function construirPrompt(pregunta: string, pasajes: Acierto[], l: Lengua): string {
  const p = pasajes.map((a, i) => `[P${i + 1}] ${a.cita}\n${a.texto.replace(/\s+/g, ' ').trim()}`).join('\n\n');
  return `${l === 'es' ? 'PREGUNTA' : 'QUESTION'}: ${pregunta}\n\n${l === 'es' ? 'PASAJES' : 'PASSAGES'}:\n${p}\n`;
}

export function leerJson(texto: string): { afirmacion?: string; pasaje?: string; cita_literal?: string }[] {
  const s = texto.replace(/```(?:json)?/g, '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return [];
  try {
    const j = JSON.parse(s.slice(a, b + 1)) as { respuesta?: unknown };
    return Array.isArray(j.respuesta) ? (j.respuesta as never[]) : [];
  } catch { return []; }
}

const plano = (s: string) => s.normalize('NFC').replace(/[«»“”"‘’']/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

/** La frase literal del pasaje que respalda la cita del modelo, o null si no hay ninguna creíble. */
export function fraseLiteral(pasaje: string, cita: string): { frase: string; literal: boolean } | null {
  const p = pasaje.replace(/\s+/g, ' ').trim();
  const c = cita.replace(/\s+/g, ' ').trim();
  if (!c) return null;
  // ¿Está tal cual (sin contar comillas, mayúsculas ni blancos)?
  const i = plano(p).indexOf(plano(c));
  if (i >= 0 && plano(c).length >= 12) {
    // Recupera el tramo original del pasaje (misma longitud en la versión plana salvo comillas: se busca por palabras).
    const pal = c.split(' ');
    const re = new RegExp(pal.map((w) => w.replace(/[«»“”"‘’']/g, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).filter(Boolean).join('[\\s«»“”"‘’\']+'), 'i');
    const m = re.exec(p);
    return { frase: m ? m[0] : c, literal: true };
  }
  // Si no, la frase del pasaje con más palabras en común (≥ 80 %).
  const frases = p.match(/[^.!?;:]+[.!?;:]?/g) ?? [p];
  const pc = new Set(plano(c).match(/[\p{L}\p{N}]{3,}/gu) ?? []);
  let mejor: { f: string; s: number } = { f: '', s: 0 };
  for (const f of frases) {
    const pf = new Set(plano(f).match(/[\p{L}\p{N}]{3,}/gu) ?? []);
    let k = 0; for (const w of pc) if (pf.has(w)) k++;
    const s = pc.size ? k / pc.size : 0;
    if (s > mejor.s) mejor = { f: f.trim(), s };
  }
  return mejor.s >= 0.8 ? { frase: mejor.f, literal: false } : null;
}

export async function preguntar(nucleo: Nucleo, o: { ambito: string; pregunta: string; motor: MotorIA; lengua: Lengua; modelo?: string },
  ev: { fase?: (f: 'buscar' | 'redactar' | 'verificar') => void; token?: (t: string) => void } = {}): Promise<Respuesta> {
  ev.fase?.('buscar');
  const r = await nucleo.buscar({ ambito: o.ambito, consulta: o.pregunta, modo: 'hibrida', limite: 8, lengua: o.lengua });
  const pasajes = r.aciertos.slice(0, 8);
  if (!pasajes.length) return { aceptadas: [], descartadas: [], pasajes };
  ev.fase?.('redactar');
  const salida = await nucleo.generar(construirPrompt(o.pregunta, pasajes, o.lengua), { motor: o.motor, modelo: o.modelo, system: instrucciones(o.lengua), temperature: 0.1, max_tokens: 900 }, (t) => ev.token?.(t));
  ev.fase?.('verificar');
  const aceptadas: Afirmacion[] = [];
  const descartadas: Afirmacion[] = [];
  for (const c of leerJson(salida)) {
    const k = Number(String(c.pasaje ?? '').replace(/\D/g, '')) - 1;
    const pasaje = pasajes[k];
    const texto = String(c.afirmacion ?? '').trim();
    if (!texto) continue;
    if (!pasaje) { descartadas.push({ texto, pasaje: pasajes[0], cita: '', literal: false, apoyo: 0, etiqueta: '', motivo: 'sin-pasaje' }); continue; }
    const f = fraseLiteral(pasaje.texto, String(c.cita_literal ?? ''));
    if (!f) { descartadas.push({ texto, pasaje, cita: '', literal: false, apoyo: 0, etiqueta: '', motivo: 'cita-inventada' }); continue; }
    let apoyo = 0, etiqueta = '';
    try { const j = await nucleo.juzgar(texto, pasaje.texto, o.motor); apoyo = j.supported; etiqueta = j.label; } catch { apoyo = 0; etiqueta = 'error'; }
    const a: Afirmacion = { texto, pasaje, cita: f.frase, literal: f.literal, apoyo, etiqueta };
    if (apoyo >= UMBRAL) aceptadas.push(a); else descartadas.push({ ...a, motivo: 'sin-respaldo' });
  }
  return { aceptadas, descartadas, pasajes, bruto: salida };
}
