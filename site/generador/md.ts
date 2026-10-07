/**
 * Markdown → HTML para la web, con marked: encabezados con id estable (para
 * enlazar secciones de la especificación), tablas envueltas para que se
 * desplacen en el móvil, bloques de código con botón de copiar y las palabras
 * clave del BCP 14 (MUST, SHOULD, MAY… y sus equivalentes en castellano)
 * marcadas para que se vean como lo que son: obligaciones.
 */
import { Marked, type Tokens } from 'marked';
import { esc } from './sitio';

export interface Encabezado { nivel: number; texto: string; id: string }

/** Identificador estable: minúsculas, sin tildes, con guiones (como GitHub, salvo las tildes). */
export function idDe(t: string): string {
  return t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[`*_[\]()«»"“”‘’'¿?¡!,:;/§]/g, '')
    .replace(/\./g, '-')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72);
}

const BCP14_EN = /\b(MUST NOT|MUST|REQUIRED|SHALL NOT|SHALL|SHOULD NOT|SHOULD|NOT RECOMMENDED|RECOMMENDED|MAY|OPTIONAL)\b/g;
const BCP14_ES = /(?<![\p{L}])(NO DEBE|DEBE|NO DEBERÁ|DEBERÁ|NO DEBERÍA|DEBERÍA|OBLIGATORIO|OBLIGATORIA|NO RECOMENDADO|RECOMENDADO|RECOMENDADA|PUEDE|OPCIONAL)(?![\p{L}])/gu;

/** Marca las palabras clave fuera de etiquetas y de código. */
function marcarBcp14(html: string): string {
  return html.replace(/(<code[\s\S]*?<\/code>|<pre[\s\S]*?<\/pre>|<[^>]+>)|([^<]+)/g, (m, etiqueta: string | undefined, texto: string | undefined) => {
    if (etiqueta) return etiqueta;
    return (texto ?? m)
      .replace(BCP14_EN, '<span class="bcp14">$1</span>')
      .replace(BCP14_ES, '<span class="bcp14">$1</span>');
  });
}

export interface Opciones {
  /** Suma a los niveles de encabezado (un # del fichero pasa a ser h2 si es 1). */
  nivelBase?: number;
  copiar?: string;
  bcp14?: boolean;
  /** Reescribe los enlaces relativos del Markdown fuente (p. ej. a otras hojas de la web). */
  enlace?: (href: string) => string | null;
}

export function aHtml(md: string, o: Opciones = {}): { html: string; encabezados: Encabezado[] } {
  const encabezados: Encabezado[] = [];
  const usados = new Set<string>();
  const marked = new Marked({ gfm: true });
  marked.use({
    renderer: {
      heading(this: { parser: { parseInline: (t: Tokens.Generic[]) => string } }, t: Tokens.Heading) {
        const nivel = Math.min(6, t.depth + (o.nivelBase ?? 0));
        const interior = this.parser.parseInline(t.tokens);
        const explicito = /\s*\{#([\w-]+)\}\s*$/.exec(t.text);
        const limpio = interior.replace(/\s*\{#[\w-]+\}\s*$/, '');
        let id = explicito?.[1] ?? idDe(t.text.replace(/\s*\{#[\w-]+\}\s*$/, ''));
        if (!id) id = 'seccion';
        const base = id;
        let n = 2;
        while (usados.has(id)) id = `${base}-${n++}`;
        usados.add(id);
        encabezados.push({ nivel, texto: limpio.replace(/<[^>]+>/g, ''), id });
        return `<h${nivel} id="${id}"><a class="ancla" href="#${id}" aria-hidden="true" tabindex="-1">§</a>${limpio}</h${nivel}>\n`;
      },
      table(this: { parser: { parseInline: (t: Tokens.Generic[]) => string } }, t: Tokens.Table) {
        const celda = (c: Tokens.TableCell, i: number, tag: 'th' | 'td') => {
          const al = t.align[i];
          return `<${tag}${tag === 'th' ? ' scope="col"' : ''}${al ? ` class="a-${al}"` : ''}>${this.parser.parseInline(c.tokens)}</${tag}>`;
        };
        const cab = `<tr>${t.header.map((c, i) => celda(c, i, 'th')).join('')}</tr>`;
        const filas = t.rows.map((f) => `<tr>${f.map((c, i) => celda(c, i, 'td')).join('')}</tr>`).join('');
        return `<div class="tabla" tabindex="0"><table><thead>${cab}</thead><tbody>${filas}</tbody></table></div>\n`;
      },
      code(t: Tokens.Code) {
        const lengua = (t.lang ?? '').split(/\s/)[0] ?? '';
        return `<div class="codigo"${lengua ? ` data-lengua="${esc(lengua)}"` : ''}><button class="copiar" type="button">${o.copiar ?? 'Copy'}</button><pre tabindex="0"><code${lengua ? ` class="l-${esc(lengua)}"` : ''}>${esc(t.text)}</code></pre></div>\n`;
      },
      link(this: { parser: { parseInline: (t: Tokens.Generic[]) => string } }, t: Tokens.Link) {
        const href = o.enlace ? o.enlace(t.href) : t.href;
        if (href === null) return this.parser.parseInline(t.tokens);
        const fuera = /^https?:\/\//.test(href) && !href.includes('spdf.joseluissaorin.com');
        return `<a href="${esc(href)}"${t.title ? ` title="${esc(t.title)}"` : ''}${fuera ? ' rel="noopener"' : ''}>${this.parser.parseInline(t.tokens)}</a>`;
      },
    },
  });
  let html = marked.parse(md, { async: false }) as string;
  if (o.bcp14) html = marcarBcp14(html);
  return { html, encabezados };
}

/** Separa la cabecera YAML sencilla (clave: valor) del cuerpo. */
export function frontal(md: string): { datos: Record<string, string>; cuerpo: string } {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(md);
  if (!m) return { datos: {}, cuerpo: md };
  const datos: Record<string, string> = {};
  for (const l of m[1]!.split('\n')) {
    const i = l.indexOf(':');
    if (i > 0) datos[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^"(.*)"$/, '$1');
  }
  return { datos, cuerpo: md.slice(m[0].length) };
}

/** El texto plano de un trozo de Markdown (para descripciones y JSON-LD). */
export function textoPlano(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[`*_]/g, '')
    .replace(/^[#>|:-]+\s*/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}
