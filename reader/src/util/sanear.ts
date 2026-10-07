/**
 * HTML de confianza a medias (la salida de citeproc con metadatos que vienen del
 * fichero): solo se dejan etiquetas de formato y ningún atributo salvo `class`.
 */
const PERMITIDAS = new Set(['I', 'B', 'EM', 'STRONG', 'SPAN', 'DIV', 'SUP', 'SUB', 'BR']);

export function sanear(html: string): string {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const raiz = doc.body.firstElementChild!;
  const limpiar = (el: Element) => {
    for (const h of [...el.children]) {
      if (!PERMITIDAS.has(h.tagName)) { h.replaceWith(doc.createTextNode(h.textContent ?? '')); continue; }
      for (const a of [...h.attributes]) if (a.name !== 'class') h.removeAttribute(a.name);
      limpiar(h);
    }
  };
  limpiar(raiz);
  return raiz.innerHTML;
}
