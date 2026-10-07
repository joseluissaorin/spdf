/**
 * Revectorizar con el modelo pequeño de pruebas (vectores deterministas, sin
 * descarga) y buscar por significado en el resultado. El fichero nuevo tiene
 * que validar como SPDF 5.0 y llevar su espacio.
 */
import { test, expect } from '@playwright/test';
import { abrirLimpio, importarYAbrir, dato, CAPTURAS } from './ayudas';
import { resolve } from 'node:path';

test('revectorizar (recorte 256) en una copia y buscar por significado', async ({ page }) => {
  await abrirLimpio(page);
  await importarYAbrir(page, dato('quijote-cap1.spdf'));
  await page.getByRole('button', { name: 'Exportar' }).click();
  await page.getByRole('menuitem', { name: 'Revectorizar' }).click();
  const d = page.locator('dialog[open]');
  await d.getByLabel('Modelo de pruebas (falso)').check();
  await d.getByRole('radio', { name: '256' }).click();
  await d.getByLabel('En una copia nueva').check();
  await page.screenshot({ path: resolve(CAPTURAS, 'web-revectorizar.png') });
  await d.getByRole('button', { name: 'Empezar' }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0, { timeout: 60_000 });
  // La copia se abre sola y está en la biblioteca con su espacio.
  await page.getByRole('button', { name: 'Ficha', exact: true }).click();
  await expect(page.locator('.panel')).toContainText('spdf-fake@256');
  await expect(page.locator('.panel .sello.azul', { hasText: 'Válido' })).toBeVisible({ timeout: 20_000 });
  await page.keyboard.press('Escape');
  // Buscar por significado: hay vectores compatibles y el resultado viene «por vector».
  await page.keyboard.press('/');
  await page.getByRole('button', { name: 'Semántica' }).click();
  await page.locator('#q').fill('libros de caballerías');
  await page.locator('#q').press('Enter');
  await expect(page.locator('.resultado').first()).toBeVisible();
  await expect(page.locator('.aviso-busqueda')).toHaveCount(0);
  await expect(page.locator('.resultado .sello.azul').first()).toHaveText('Semántica');
  await page.getByRole('button', { name: 'Híbrida' }).click();
  await expect(page.locator('.resultado').first()).toContainText(/caballer/);
  await page.screenshot({ path: resolve(CAPTURAS, 'web-busqueda-semantica.png') });
  await page.goto('./?pruebas#/');
  await expect(page.locator('.ficha-libro')).toHaveCount(2);
  await expect(page.locator('.ficha-libro .sello.azul', { hasText: 'spdf-fake@256' })).toHaveCount(1);
});
