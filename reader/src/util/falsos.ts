/**
 * Generador y juez de pruebas (modo `?pruebas`): sin modelos ni descargas, para
 * las pruebas de extremo a extremo de «Preguntar». El embebedor de pruebas es el
 * `FakeEmbedder` de spdf-infer-web (mismos vectores que el de Rust).
 */
export async function generarFalso(prompt: string, alToken: (t: string) => void): Promise<string> {
  const m = /\[(P\d+)\][^\n]*\n([^\n]+)/.exec(prompt);
  const frase = m ? (m[2].match(/[^.;:]+[.;:]/)?.[0] ?? m[2]).trim() : '';
  const texto = m ? JSON.stringify({ respuesta: [{ afirmacion: frase, pasaje: m[1], cita_literal: frase }] }) : '{"respuesta":[]}';
  for (const t of texto.match(/.{1,12}/g) ?? []) alToken(t);
  return texto;
}

export function juzgarFalso(afirmacion: string, pasaje: string): { supported: number; label: string } {
  const pal = (s: string) => new Set(s.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []);
  const a = pal(afirmacion), b = pal(pasaje);
  let c = 0; for (const x of a) if (b.has(x)) c++;
  const s = a.size ? c / a.size : 0;
  return { label: s > 0.6 ? 'APOYO_DIRECTO' : 'CONTEXTO', supported: s };
}
