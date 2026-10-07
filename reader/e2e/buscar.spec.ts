import { test, expect } from '@playwright/test';
import { abrirLimpio, importar, importarYAbrir, dato, CONFORMIDAD, CAPTURAS, volverABiblioteca } from './ayudas';
import { resolve } from 'node:path';

test('búsqueda en la biblioteca: abrir un resultado, recorrerlos y volver con la lista en su sitio', async ({ page }) => {
  await abrirLimpio(page);
  await importar(page, [dato('quijote-cap1.spdf'), resolve(CONFORMIDAD, 'files/quijote.spdf'), resolve(CONFORMIDAD, 'files/lazarillo.spdf')]);
  await expect(page.locator('.ficha-libro')).toHaveCount(3, { timeout: 30_000 });
  await page.locator('#q-biblioteca').fill('caballero');
  await page.locator('#q-biblioteca').press('Enter');
  const resultados = page.locator('.panel .resultado');
  await expect(resultados.first()).toBeVisible();
  const n = await resultados.count();
  expect(n).toBeGreaterThan(2);
  await page.screenshot({ path: resolve(CAPTURAS, 'web-buscar-biblioteca.png') });
  await resultados.nth(1).click();
  await expect(page.locator('.pasaje.destacado')).toBeVisible();
  // (El término puede no estar resaltado: en el Quijote de 1608, «caballero» casa por la capa modernizada.)
  await expect(page.locator('.navegador-resultados span')).toHaveText(`2/${n}`);
  await page.keyboard.press('n');
  await expect(page.locator('.navegador-resultados span')).toHaveText(`3/${n}`);
  await page.getByRole('button', { name: 'Anterior', exact: true }).click();
  await expect(page.locator('.navegador-resultados span')).toHaveText(`2/${n}`);
  await page.screenshot({ path: resolve(CAPTURAS, 'web-buscar-resultado.png') });
  // Al volver, la lista sigue ahí, con el resultado abierto marcado.
  await volverABiblioteca(page);
  await expect(page.locator('.panel .resultado[aria-current="true"]')).toBeVisible();
  await expect(page.locator('.panel .resultado')).toHaveCount(n);
});

test('búsqueda léxica con la capa modernizada y aviso cuando no hay vectores', async ({ page }) => {
  await abrirLimpio(page);
  await importarYAbrir(page, dato('quijote-cap1.spdf'));
  await page.keyboard.press('/');
  await page.locator('#q').fill('lentejas');
  await expect(page.locator('.resultado').first()).toContainText('lantejas');
  await page.getByRole('button', { name: 'Semántica' }).click();
  await expect(page.locator('.aviso-busqueda')).toContainText(/léxica/);
});
