import { test, expect } from '@playwright/test';
import { abrirLimpio, importar, DATOS, CAPTURAS } from './ayudas';
import { resolve } from 'node:path';

test('bienvenida, importar y leer', async ({ page }) => {
  page.on('console', (m) => { if (m.type() === 'error') console.log('consola:', m.text()); });
  page.on('pageerror', (e) => console.log('error de página:', e.message));
  await abrirLimpio(page);
  await expect(page.getByRole('heading', { name: /Lector/ })).toBeVisible();
  await page.waitForTimeout(5500);
  await page.screenshot({ path: resolve(CAPTURAS, 'web-bienvenida.png') });
  await importar(page, [resolve(DATOS, 'quijote-cap1.spdf')]);
  // Un solo fichero: se abre directamente.
  await expect(page.locator('.hoja article')).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: resolve(CAPTURAS, 'web-lector-portada.png') });
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.hoja article')).toContainText('En un lugar de la Mancha');
  await page.waitForTimeout(600);
  await page.screenshot({ path: resolve(CAPTURAS, 'web-lector-pagina.png') });
});
