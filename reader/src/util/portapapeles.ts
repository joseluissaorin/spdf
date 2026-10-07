/** Copiar al portapapeles, con el método antiguo como respaldo (webviews sin permiso). */
export async function copiar(texto: string, html?: string): Promise<boolean> {
  try {
    if (html && 'ClipboardItem' in window) {
      await navigator.clipboard.write([new ClipboardItem({
        'text/plain': new Blob([texto], { type: 'text/plain' }),
        'text/html': new Blob([html], { type: 'text/html' }),
      })]);
      return true;
    }
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    const ta = Object.assign(document.createElement('textarea'), { value: texto });
    ta.style.cssText = 'position:fixed;opacity:0;top:0';
    document.body.append(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}
