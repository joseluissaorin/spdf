import { test, expect } from '@playwright/test';
import { abrirLimpio, importarYAbrir, dato, CAPTURAS } from './ayudas';
import { resolve } from 'node:path';

test('bienvenida, importar y leer página a página', async ({ page }) => {
  await abrirLimpio(page);
  await expect(page.getByRole('heading', { name: /Lector/ })).toBeVisible();
  await page.waitForTimeout(5500); // que la pluma termine de dibujar
  await page.screenshot({ path: resolve(CAPTURAS, 'web-bienvenida.png') });
  await importarYAbrir(page, dato('quijote-cap1.spdf'));
  await page.waitForTimeout(500);
  await page.screenshot({ path: resolve(CAPTURAS, 'web-lector-portada.png') });
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
  await expect(page.locator('.hoja article')).toContainText('En un lugar de la Mancha');
  await expect(page.locator('.hoja .margen .folio')).toHaveText('1');
  await page.waitForTimeout(500);
  await page.screenshot({ path: resolve(CAPTURAS, 'web-lector-pagina.png') });
});
