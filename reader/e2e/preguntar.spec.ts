/** Preguntar con el modelo de pruebas: la respuesta cita solo texto literal del SPDF, con su ancla. */
import { test, expect } from '@playwright/test';
import { abrirLimpio, importarYAbrir, dato, CAPTURAS } from './ayudas';
import { resolve } from 'node:path';

test('preguntar: cada afirmación lleva su frase literal y su cita', async ({ page }) => {
  await abrirLimpio(page);
  await importarYAbrir(page, dato('quijote-cap1.spdf'));
  await page.getByRole('button', { name: 'Preguntar', exact: true }).first().click();
  await page.getByLabel('Modelo de pruebas (falso)').check();
  await page.locator('#pregunta').fill('¿Cómo se llamaba el caballo del hidalgo? Rocinante');
  await page.locator('.panel').getByRole('button', { name: 'Preguntar' }).click();
  const af = page.locator('.afirmacion').first();
  await expect(af).toBeVisible({ timeout: 30_000 });
  const cita = (await af.locator('blockquote').textContent())!.replace(/^«|»$/g, '');
  // La frase citada está, tal cual, en el texto del documento.
  const enDoc = await page.evaluate(async (c) => {
    const n = (window as unknown as { __spdf: { fragmentos(id: string): Promise<{ text: string }[]> } }).__spdf;
    const id = location.hash.split('/')[2];
    return (await n.fragmentos(id)).some((f) => f.text.replace(/\s+/g, ' ').includes(c));
  }, cita);
  expect(enDoc).toBe(true);
  await expect(af.locator('.mono.rojo')).toContainText('Cervantes Saavedra, 1605');
  await page.screenshot({ path: resolve(CAPTURAS, 'web-preguntar.png') });
});
