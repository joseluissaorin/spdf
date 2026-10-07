import { test, expect } from '@playwright/test';
import { abrirLimpio, importarYAbrir, dato, portapapeles, CAPTURAS } from './ayudas';
import { resolve } from 'node:path';

test('copiar la cita corta con folio, la referencia (APA, Chicago, BibTeX, CSL-JSON) e ir a una página impresa', async ({ page }) => {
  await abrirLimpio(page);
  await importarYAbrir(page, dato('quijote-cap1.spdf'));
  // Ir a la página impresa «iv» (preliminares en romanos) y luego a la 3.
  await page.locator('#folio').fill('iv');
  await page.locator('#folio').press('Enter');
  await expect(page.locator('.hoja .margen .folio')).toHaveText('iv');
  await page.locator('#folio').fill('3');
  await page.locator('#folio').press('Enter');
  await expect(page.locator('.hoja .margen .folio')).toHaveText('3');
  // Un clic: la cita corta con el folio.
  await page.getByRole('button', { name: 'Copiar la cita' }).click();
  await expect.poll(() => portapapeles(page)).toBe('(Cervantes Saavedra, 1605, p. 3)');
  // La página sin folio se cita «s. p.».
  await page.locator('#folio').fill('#1');
  await page.locator('#folio').press('Enter');
  await page.getByRole('button', { name: 'Copiar la cita' }).click();
  await expect.poll(() => portapapeles(page)).toBe('(Cervantes Saavedra, 1605, s. p.)');
  await page.locator('#folio').fill('1');
  await page.locator('#folio').press('Enter');
  // La referencia completa.
  await page.getByRole('button', { name: 'Exportar' }).click();
  await page.getByRole('menuitem', { name: 'Referencia bibliográfica' }).click();
  const dialogo = page.locator('dialog[open]');
  await expect(dialogo.locator('.cita-grande')).toHaveText('(Cervantes Saavedra, 1605, p. 1)');
  await dialogo.getByRole('button', { name: 'APA 7' }).click();
  await expect(dialogo.locator('.salida-cita')).toContainText('Cervantes Saavedra, M. de. (1605). El ingenioso hidalgo don Quijote de la Mancha');
  await page.screenshot({ path: resolve(CAPTURAS, 'web-citar.png') });
  await dialogo.getByRole('button', { name: 'Chicago (autor-fecha)' }).click();
  await expect(dialogo.locator('.salida-cita')).toContainText('Cervantes Saavedra, Miguel de');
  await dialogo.getByRole('button', { name: 'BibTeX' }).click();
  await expect(dialogo.locator('.salida-cita')).toContainText('@book{');
  await dialogo.getByRole('button', { name: 'CSL-JSON' }).click();
  await expect(dialogo.locator('.salida-cita')).toContainText('"title"');
  await dialogo.getByRole('button', { name: /Copiar: Referencia/ }).click();
  await expect.poll(() => portapapeles(page)).toContain('"type": "book"');
  await expect(dialogo.locator('pre').last()).toContainText('spdf:sha256-');
  await expect(dialogo.locator('pre').last()).toContainText('f=1');
});

test('citar un pasaje con la manícula y citar una selección con sus caracteres exactos', async ({ page }) => {
  await abrirLimpio(page);
  await importarYAbrir(page, dato('quijote-cap1.spdf'));
  await page.locator('#folio').fill('1');
  await page.locator('#folio').press('Enter');
  const pasaje = page.locator('.pasaje', { hasText: 'En un lugar de la Mancha' });
  await pasaje.hover();
  await pasaje.getByRole('button', { name: 'Citar este pasaje' }).click();
  await expect.poll(() => portapapeles(page)).toMatch(/^«En un lugar de la Mancha.*» \(Cervantes Saavedra, 1605, p\. 1\)$/);
  // Seleccionar «lanza en astillero» y citar la selección.
  await page.evaluate(() => {
    const span = [...document.querySelectorAll('.hoja article [data-o]')].find((s) => s.textContent!.includes('lanza en astillero'))!;
    const nodo = span.firstChild!;
    const i = nodo.textContent!.indexOf('lanza en astillero');
    const r = document.createRange();
    r.setStart(nodo, i); r.setEnd(nodo, i + 'lanza en astillero'.length);
    getSelection()!.removeAllRanges(); getSelection()!.addRange(r);
    span.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await page.getByRole('button', { name: 'Citar la selección' }).click();
  await expect.poll(() => portapapeles(page)).toBe('«lanza en astillero» (Cervantes Saavedra, 1605, p. 1)');
});
