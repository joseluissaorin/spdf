/** Subrayados y notas: en el fichero hermano .spdfa.json (W3C Web Annotation), nunca dentro del SPDF. */
import { test, expect } from '@playwright/test';
import { abrirLimpio, importarYAbrir, dato, CAPTURAS } from './ayudas';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

async function seleccionar(page: import('@playwright/test').Page, texto: string) {
  await page.evaluate((t) => {
    const span = [...document.querySelectorAll('.hoja article [data-o]')].find((s) => s.textContent!.includes(t))!;
    const nodo = span.firstChild!;
    const i = nodo.textContent!.indexOf(t);
    const r = document.createRange();
    r.setStart(nodo, i); r.setEnd(nodo, i + t.length);
    getSelection()!.removeAllRanges(); getSelection()!.addRange(r);
    span.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  }, texto);
}

test('subrayar, anotar y exportar .spdfa.json y Markdown con citas', async ({ page }) => {
  await abrirLimpio(page);
  await importarYAbrir(page, dato('quijote-cap1.spdf'));
  await page.locator('#folio').fill('1');
  await page.locator('#folio').press('Enter');
  await expect(page.locator('.hoja .margen .folio')).toHaveText('1');
  await seleccionar(page, 'rocín flaco y galgo corredor');
  await page.getByRole('button', { name: 'Subrayar' }).click();
  await expect(page.locator('mark.subrayado')).toHaveText('rocín flaco y galgo corredor');
  await seleccionar(page, 'duelos y quebrantos');
  await page.getByRole('button', { name: 'Nota' }).click();
  await page.locator('#texto-nota').fill('Huevos con torreznos: comida de vigilia permitida.');
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.locator('mark.subrayado')).toHaveCount(2);
  await page.screenshot({ path: resolve(CAPTURAS, 'web-anotaciones.png') });
  // Siguen ahí al recargar (fichero hermano en OPFS).
  await page.reload();
  await expect(page.locator('.hoja .margen .folio')).toHaveText('1');
  await expect(page.locator('mark.subrayado')).toHaveCount(2);
  // Exportar la colección W3C.
  const [descarga] = await Promise.all([page.waitForEvent('download'), (async () => {
    await page.getByRole('button', { name: 'Exportar' }).click();
    await page.getByRole('menuitem', { name: 'Anotaciones (.spdfa.json)' }).click();
  })()]);
  expect(descarga.suggestedFilename()).toMatch(/\.spdfa\.json$/);
  const j = JSON.parse(readFileSync(await descarga.path(), 'utf8'));
  expect(j.type).toBe('AnnotationCollection');
  expect(j.spdf_annotations).toBe('1.0');
  const items = j.first.items;
  expect(items).toHaveLength(2);
  const sel = items[0].target.selector.find((s: { type: string }) => s.type === 'SpdfAnchorSelector');
  expect(sel.value).toMatch(/^spdf:sha256-[0-9a-f]{64}#p=4&f=1&char=\d+,\d+$/);
  expect(items.find((i: { motivation: string }) => i.motivation === 'commenting').body.value).toContain('torreznos');
  // Markdown con las citas.
  const [md] = await Promise.all([page.waitForEvent('download'), (async () => {
    await page.getByRole('button', { name: 'Exportar' }).click();
    await page.getByRole('menuitem', { name: 'Markdown con citas' }).click();
  })()]);
  const texto = readFileSync(await md.path(), 'utf8');
  expect(texto).toContain('> «rocín flaco y galgo corredor» (Cervantes Saavedra, 1605, p. 1)');
  expect(texto).toContain('Huevos con torreznos');
});
