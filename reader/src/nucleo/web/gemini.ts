/**
 * Gemini con la clave del usuario, desde el navegador (respaldo por si
 * `spdf-infer-web` no trae GeminiEmbedder/GeminiGenerator). La clave va en la
 * cabecera `x-goog-api-key`, nunca en la URL, y solo a generativelanguage.googleapis.com.
 *
 * Embedding 2 no admite `taskType`: la tarea va dentro del texto, igual que hace
 * Scholaris (los SPDF 4.x con `gemini-embedding-2@1536` se codificaron así).
 */
import type { Espacio } from '../tipos';
import type { OpcionesGenerar } from '../nucleo';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
export const MODELO_VECTORES = 'gemini-embedding-2';
export const MODELO_TEXTO = 'gemini-flash-latest';
export const PREFIJOS = { query: 'task: search result | query: ', document: 'title: none | text: ' };

async function pedir(clave: string, ruta: string, cuerpo: unknown): Promise<Response> {
  const r = await fetch(`${BASE}/${ruta}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': clave },
    body: JSON.stringify(cuerpo),
  });
  if (!r.ok) {
    let m = `${r.status}`;
    try { m = (await r.json()).error?.message ?? m; } catch { /* sin cuerpo */ }
    throw new Error(`Gemini: ${m}`);
  }
  return r;
}

function normalizar(v: Float32Array): Float32Array {
  let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= n;
  return v;
}

export function incrustador(clave: string) {
  return {
    space(dims = 1536): Espacio {
      return { id: `${MODELO_VECTORES}@${dims}`, provider: 'google', model: MODELO_VECTORES, version: null, dims, dtype: 'f32', normalized: 1, truncated_from: null, modalities: ['text'], task_prefixes: PREFIJOS, created: null };
    },
    async embed(textos: string[], o: { task: string; dims?: number }): Promise<Float32Array[]> {
      const pref = o.task === 'query' ? PREFIJOS.query : PREFIJOS.document;
      const out: Float32Array[] = [];
      for (let i = 0; i < textos.length; i += 100) {
        const parte = textos.slice(i, i + 100);
        const r = await pedir(clave, `models/${MODELO_VECTORES}:batchEmbedContents`, {
          requests: parte.map((t) => ({ model: `models/${MODELO_VECTORES}`, content: { parts: [{ text: pref + t.slice(0, 24000) }] }, outputDimensionality: o.dims ?? 1536 })),
        });
        const j = (await r.json()) as { embeddings?: { values: number[] }[] };
        for (const e of j.embeddings ?? []) out.push(normalizar(Float32Array.from(e.values)));
      }
      return out;
    },
  };
}

/** Generación en streaming (SSE). */
export async function generar(clave: string, prompt: string, o: OpcionesGenerar, alToken: (t: string) => void): Promise<void> {
  const r = await pedir(clave, `models/${o.modelo ?? MODELO_TEXTO}:streamGenerateContent?alt=sse`, {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    ...(o.system ? { systemInstruction: { parts: [{ text: o.system }] } } : {}),
    generationConfig: { temperature: o.temperature ?? 0.2, maxOutputTokens: o.max_tokens ?? 1200, responseMimeType: 'application/json' },
  });
  const lector = r.body!.pipeThrough(new TextDecoderStream()).getReader();
  let resto = '';
  for (;;) {
    const { value, done } = await lector.read();
    if (done) break;
    resto += value;
    let k;
    while ((k = resto.indexOf('\n')) >= 0) {
      const linea = resto.slice(0, k).trim();
      resto = resto.slice(k + 1);
      if (!linea.startsWith('data:')) continue;
      try {
        const j = JSON.parse(linea.slice(5));
        for (const p of j.candidates?.[0]?.content?.parts ?? []) if (p.text) alToken(p.text);
      } catch { /* línea partida: llega entera en el siguiente trozo */ }
    }
  }
}

const RELACIONES = ['APOYO_DIRECTO', 'APLICACION_DE_MARCO', 'CONTEXTO', 'CONTRADICCION', 'IMPOSIBLE_TEMPORAL', 'OPINION_REFERIDA', 'AFIRMACION_NEGATIVA'];

/** El juez con Gemini: misma pregunta y mismas etiquetas que el juez local. */
export async function juzgar(clave: string, afirmacion: string, pasaje: string): Promise<{ supported: number; label: string }> {
  const r = await pedir(clave, `models/${MODELO_TEXTO}:generateContent`, {
    contents: [{ role: 'user', parts: [{ text: `¿El PASAJE respalda la AFIRMACIÓN? Responde con la relación (una de ${RELACIONES.join(', ')}) y la probabilidad (0-1) de que el pasaje la respalde directamente o por aplicación de su marco.\n\nAFIRMACIÓN: ${afirmacion}\n\nPASAJE: ${pasaje}` }] }],
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
      responseSchema: { type: 'OBJECT', properties: { relacion: { type: 'STRING', enum: RELACIONES }, probabilidad: { type: 'NUMBER' } }, required: ['relacion', 'probabilidad'] },
    },
  });
  const j = await r.json();
  const t = j.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';
  const o = JSON.parse(t) as { relacion?: string; probabilidad?: number };
  return { label: o.relacion ?? 'CONTEXTO', supported: Math.max(0, Math.min(1, Number(o.probabilidad ?? 0))) };
}
