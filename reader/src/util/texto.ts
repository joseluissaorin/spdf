/**
 * El texto de una unidad, preparado para pintarlo sin perder la cuenta de
 * dónde está cada carácter. `units.text` es NFC con Markdown ligero; las anclas
 * cuentan en puntos de código sobre ese texto (contrato §3, `chars`). Aquí se
 * trabaja en unidades UTF-16 (lo que usa el DOM) y se convierte en los bordes.
 *
 * Bloques: párrafos (separados por línea en blanco), títulos (`# `) y citas
 * (`> `). Dentro, **negrita** y *cursiva*; los saltos de línea simples se
 * conservan (en verso importan). Cada trozo pintado lleva su desplazamiento de
 * origen, así que una selección del usuario se traduce a `chars` exactos.
 */

export interface Tramo { desde: number; hasta: number; em?: boolean; strong?: boolean }
export interface Bloque { tipo: 'p' | 'h' | 'cita'; nivel?: number; desde: number; hasta: number; tramos: Tramo[] }
export interface Marca { desde: number; hasta: number; clase: string; id?: string; titulo?: string }

/** Puntos de código → índice UTF-16 en `s`. */
export function cpAUtf16(s: string, cp: number): number {
  let i = 0, n = 0;
  while (i < s.length && n < cp) { i += s.codePointAt(i)! > 0xffff ? 2 : 1; n++; }
  return i;
}
/** Índice UTF-16 → puntos de código. */
export function utf16ACp(s: string, i: number): number {
  let n = 0;
  for (let k = 0; k < i && k < s.length; n++) k += s.codePointAt(k)! > 0xffff ? 2 : 1;
  return n;
}

export function bloques(texto: string): Bloque[] {
  const out: Bloque[] = [];
  const re = /\n[ \t]*\n+/g;
  let ini = 0;
  const empuja = (a: number, b: number) => {
    // Recorta blancos de los bordes sin perder la cuenta.
    while (a < b && /\s/.test(texto[a])) a++;
    while (b > a && /\s/.test(texto[b - 1])) b--;
    if (a >= b) return;
    let tipo: Bloque['tipo'] = 'p';
    let nivel: number | undefined;
    let c = a;
    const h = /^(#{1,6})\s+/.exec(texto.slice(a, Math.min(b, a + 8)));
    if (h) { tipo = 'h'; nivel = h[1].length; c = a + h[0].length; }
    else if (texto.startsWith('> ', a) || texto.startsWith('>\n', a)) { tipo = 'cita'; c = a + 2; }
    out.push({ tipo, nivel, desde: a, hasta: b, tramos: enLinea(texto, c, b, tipo === 'cita') });
  };
  let m: RegExpExecArray | null;
  while ((m = re.exec(texto))) { empuja(ini, m.index); ini = m.index + m[0].length; }
  empuja(ini, texto.length);
  return out;
}

/** Negrita y cursiva; los marcadores no se pintan pero cuentan en los desplazamientos. */
function enLinea(t: string, a: number, b: number, cita: boolean): Tramo[] {
  const tramos: Tramo[] = [];
  const re = /\*\*([^*\n]+?)\*\*|(?<![\p{L}\p{N}*])\*([^*\n]+?)\*(?![\p{L}\p{N}*])/gu;
  re.lastIndex = a;
  const s = t.slice(0, b);
  let i = a;
  let m: RegExpExecArray | null;
  const llano = (x: number, y: number) => {
    if (!cita) { if (y > x) tramos.push({ desde: x, hasta: y }); return; }
    // En las citas, los «> » de las líneas siguientes tampoco se pintan.
    let k = x;
    const r = /\n> ?/g;
    r.lastIndex = x;
    let q: RegExpExecArray | null;
    while ((q = r.exec(s)) && q.index < y) { tramos.push({ desde: k, hasta: q.index + 1 }); k = q.index + q[0].length; }
    if (y > k) tramos.push({ desde: k, hasta: y });
  };
  while ((m = re.exec(s))) {
    if (m.index > i) llano(i, m.index);
    if (m[1] !== undefined) tramos.push({ desde: m.index + 2, hasta: m.index + 2 + m[1].length, strong: true });
    else tramos.push({ desde: m.index + 1, hasta: m.index + 1 + m[2].length, em: true });
    i = m.index + m[0].length;
  }
  if (b > i) llano(i, b);
  return tramos;
}

const PLIEGUE: Record<string, string> = {
  a: 'aáàâäãåā', e: 'eéèêëē', i: 'iíìîïī', o: 'oóòôöõō', u: 'uúùûüū', n: 'nñ', c: 'cç', y: 'yÿý', s: 'sſß',
};
/** Expresión que encuentra los términos sin distinguir mayúsculas ni tildes (como el índice unicode61). */
export function patronTerminos(consulta: string): RegExp | null {
  const frases: string[] = [];
  const resto = consulta.replace(/["“«„]([^"”»“]+)["”»“]/g, (_, f: string) => { frases.push(f); return ' '; });
  const terminos = [...frases, ...(resto.match(/[\p{L}\p{M}\p{N}]{2,}/gu) ?? [])];
  if (!terminos.length) return null;
  const clase = (ch: string) => {
    const b = ch.normalize('NFD').replace(/\p{Mn}/gu, '').toLowerCase();
    const p = PLIEGUE[b];
    return p ? `[${p}${p.toUpperCase()}]` : ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  };
  const alt = terminos
    .sort((a, b) => b.length - a.length)
    .map((t) => [...t].map((c) => (/\s/.test(c) ? '\\s+' : clase(c))).join(''));
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${alt.join('|')})`, 'giu');
}

export function marcasDeTerminos(texto: string, re: RegExp | null): Marca[] {
  if (!re) return [];
  const out: Marca[] = [];
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(texto))) {
    if (!m[0]) { re.lastIndex++; continue; }
    out.push({ desde: m.index, hasta: m.index + m[0].length, clase: 'termino' });
  }
  return out;
}

/** Dónde empieza un fragmento dentro del texto de la unidad, si no trae `chars`. */
export function localizar(texto: string, fragmento: string): [number, number] | null {
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
  const cabeza = norm(fragmento).slice(0, 48);
  if (!cabeza) return null;
  const i = texto.indexOf(cabeza);
  if (i >= 0) return [i, Math.min(texto.length, i + fragmento.length)];
  // Con los blancos normalizados (los saltos de línea del OCR no coinciden).
  const re = new RegExp(cabeza.split(' ').slice(0, 8).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+'));
  const m = re.exec(texto);
  return m ? [m.index, Math.min(texto.length, m.index + fragmento.length)] : null;
}

/** Trocea [a, b) por los bordes de las marcas que lo pisan. */
export function trocear(a: number, b: number, marcas: Marca[]): { desde: number; hasta: number; marcas: Marca[] }[] {
  const cortes = new Set([a, b]);
  for (const m of marcas) {
    if (m.hasta <= a || m.desde >= b) continue;
    cortes.add(Math.max(a, m.desde));
    cortes.add(Math.min(b, m.hasta));
  }
  const c = [...cortes].sort((x, y) => x - y);
  const out = [];
  for (let i = 0; i < c.length - 1; i++) {
    const x = c[i], y = c[i + 1];
    if (y <= x) continue;
    out.push({ desde: x, hasta: y, marcas: marcas.filter((m) => m.desde < y && m.hasta > x) });
  }
  return out;
}

/** El desplazamiento de origen (UTF-16) de un punto del DOM dentro de la hoja pintada. */
export function desplazamientoDe(nodo: Node, offset: number, alFinal: boolean): number | null {
  if (nodo.nodeType === Node.TEXT_NODE) {
    const span = nodo.parentElement?.closest('[data-o]') as HTMLElement | null;
    return span ? Number(span.dataset.o) + offset : null;
  }
  const el = nodo as Element;
  const hijos = [...el.childNodes];
  if (!alFinal) {
    for (const h of hijos.slice(offset)) {
      const s = (h as Element).matches?.('[data-o]') ? (h as HTMLElement) : (h as Element).querySelector?.('[data-o]') as HTMLElement | null;
      if (s) return Number(s.dataset.o);
    }
  } else {
    for (const h of hijos.slice(0, offset).reverse()) {
      const todos = (h as Element).matches?.('[data-o]') ? [h as HTMLElement] : [...((h as Element).querySelectorAll?.('[data-o]') ?? [])] as HTMLElement[];
      const s = todos.at(-1);
      if (s) return Number(s.dataset.o) + (s.textContent?.length ?? 0);
    }
  }
  return null;
}
