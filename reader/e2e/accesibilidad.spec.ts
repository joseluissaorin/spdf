/** Accesibilidad: axe-core sin infracciones graves en la biblioteca, el lector, la ficha y los ajustes, y todo con teclado. */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { abrirLimpio, importarYAbrir, dato, volverABiblioteca } from './ayudas';

async function sinGraves(page: import('@playwright/test').Page, donde: string) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  const graves = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  if (graves.length) console.log(donde, JSON.stringify(graves.map((v) => ({ id: v.id, n: v.nodes.length, ej: v.nodes[0]?.target })), null, 1));
  expect(graves, donde).toEqual([]);
}

test('axe: bienvenida, lector, ficha, búsqueda y ajustes, en claro y en oscuro', async ({ page }) => {
  // Sin animaciones: axe mediría los colores a mitad de un fundido de entrada.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await abrirLimpio(page);
  await sinGraves(page, 'bienvenida');
  await importarYAbrir(page, dato('quijote-cap1.spdf'));
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await sinGraves(page, 'lector');
  await page.keyboard.press('f');
  await expect(page.locator('.panel')).toBeVisible();
  await page.waitForTimeout(500);
  await sinGraves(page, 'ficha');
  await page.keyboard.press('Escape');
  await page.keyboard.press('/');
  await page.locator('#q').fill('hidalgo');
  await expect(page.locator('.resultado').first()).toBeVisible();
  await sinGraves(page, 'búsqueda');
  await volverABiblioteca(page);
  await sinGraves(page, 'biblioteca');
  await page.getByRole('button', { name: 'Ajustes' }).click();
  await sinGraves(page, 'ajustes');
  await page.getByRole('button', { name: 'Papel oscuro' }).click();
  await sinGraves(page, 'ajustes (oscuro)');
  await page.getByRole('button', { name: 'Volver a la biblioteca' }).click();
  await page.locator('.ficha-libro').first().click();
  await sinGraves(page, 'lector (oscuro)');
});

test('teclado: se llega a todo y la capa de texto es lo que lee el lector de pantalla', async ({ page }) => {
  await abrirLimpio(page);
  await importarYAbrir(page, dato('quijote-cap1.spdf'));
  // El enlace para saltar al texto es lo primero.
  await page.keyboard.press('Tab');
  await expect(page.locator('.saltar')).toBeFocused();
  // La capa de texto es texto real, con lengua declarada, y el facsímil tiene su texto alternativo.
  await expect(page.locator('.hoja article')).toHaveAttribute('lang', 'es');
  await expect(page.locator('.facsimil img')).toHaveAttribute('alt', /Facsímil/);
  // Atajos: g lleva al folio, ? abre la ayuda.
  await page.keyboard.press('g');
  await expect(page.locator('#folio')).toBeFocused();
  await page.keyboard.press('Escape');
  await page.locator('body').click({ position: { x: 5, y: 300 } });
  await page.keyboard.press('?');
  await expect(page.locator('dialog[open]')).toContainText('Atajos de teclado');
});
