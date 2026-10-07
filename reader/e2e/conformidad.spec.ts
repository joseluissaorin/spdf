/**
 * Abre todos los SPDF de la batería de conformidad (5.0 y legado 4.x) y los de
 * prueba del lector: cada uno se importa, aparece en la biblioteca y se lee.
 */
import { test, expect } from '@playwright/test';
import { abrirLimpio, importar, ficherosConformidad, volverABiblioteca, DATOS, CAPTURAS } from './ayudas';
import { basename, resolve } from 'node:path';
import { readdirSync } from 'node:fs';

const ficheros = [...ficherosConformidad(), ...readdirSync(DATOS).filter((f) => f.endsWith('.spdf')).map((f) => resolve(DATOS, f))];

test('se abren todos los SPDF de conformance/ (5.0 y 4.x) y los de prueba', async ({ page }) => {
  test.setTimeout(240_000);
  test.skip(ficheros.length === 0, 'no hay ficheros de conformidad');
  await abrirLimpio(page);
  await importar(page, ficheros);
  // Varios ficheros: se quedan en la biblioteca.
  await expect(page.locator('.ficha-libro')).toHaveCount(ficheros.length, { timeout: 60_000 });
  await expect(page.locator('.ficha-libro .sello.oro')).toHaveCount(ficheros.filter((f) => f.includes('/legacy/')).length);
  await page.screenshot({ path: resolve(CAPTURAS, 'web-biblioteca.png') });
  const titulos = await page.locator('.ficha-libro h3').allTextContents();
  for (const t of titulos) {
    await page.locator('.ficha-libro', { hasText: t }).first().click();
    await expect(page.locator('.hoja article, .transcripcion article, .hoja p.apagado').first()).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.vacio h2')).toHaveCount(0); // ningún borrón de error
    await volverABiblioteca(page);
  }
  console.log(`abiertos ${titulos.length}: ${ficheros.map((f) => basename(f)).join(', ')}`);
});
