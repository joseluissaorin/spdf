/**
 * De punta a punta con modelos de verdad en el navegador (WebGPU): descargar
 * EmbeddingGemma 2 con un clic, revectorizar un SPDF de SPDF Commons, buscar por
 * sentido; descargar Gemma 4 y preguntar, con citas solo desde anclas y el juez.
 * Baja ~2,4 GB la primera vez (quedan en OPFS del perfil de prueba), así que solo
 * corre bajo demanda:
 *
 *   MODELOS_REALES=1 COMMONS=/ruta/gilman-yellow-wall-paper-1901.spdf npx playwright test e2e/modelos-reales.spec.ts
 */
import { test as base, expect, chromium, type Page } from '@playwright/test';
import { importarYAbrir, CAPTURAS } from './ayudas';
import { resolve } from 'node:path';

const commons = process.env.COMMONS ?? '/tmp/commons/gilman-yellow-wall-paper-1901.spdf';
// Perfil persistente: los modelos se quedan en su OPFS entre ejecuciones (no se bajan 2,4 GB cada vez).
const test = base.extend<{ page: Page }>({
  page: async ({}, usar) => {
    const ctx = await chromium.launchPersistentContext(process.env.PERFIL ?? '/tmp/perfil-lector-modelos', {
      headless: true, viewport: { width: 1440, height: 900 }, locale: 'es-ES', baseURL: 'http://localhost:4173/',
      args: ['--mute-audio', '--enable-unsafe-webgpu', '--use-angle=metal'],
    });
    await usar(ctx.pages()[0] ?? (await ctx.newPage()));
    await ctx.close();
  },
});
test.skip(process.env.MODELOS_REALES !== '1', 'solo bajo demanda (descarga modelos reales)');

test('web con WebGPU: EmbeddingGemma 2 (revectorizar y buscar por sentido) y Gemma 4 (preguntar)', async ({ page }) => {
  test.setTimeout(3_600_000);
  const fase = (f: string) => console.log(new Date().toISOString().slice(11, 19), f);
  page.on('console', (m) => console.log('consola', m.type(), m.text().slice(0, 300)));
  page.on('pageerror', (e) => console.log('error de página:', e.message));
  page.on('worker', (w) => w.on('console' as never, (m: { type(): string; text(): string }) => console.log('worker', m.type(), m.text().slice(0, 300))));
  await page.goto('./');
  // La biblioteca se vacía; los modelos (OPFS de spdf-infer-web) se conservan.
  await page.evaluate(async () => { localStorage.clear(); const r = await navigator.storage.getDirectory(); try { await r.removeEntry('spdf-lector', { recursive: true }); } catch { /* vacío */ } });
  await page.reload();
  await importarYAbrir(page, commons);

  // Revectorizar: el diálogo propone el modelo de solo texto y lo baja con un clic.
  await page.getByRole('button', { name: 'Exportar' }).click();
  await page.getByRole('menuitem', { name: 'Revectorizar' }).click();
  const d = page.locator('dialog[open]');
  await d.getByLabel(/EmbeddingGemma 2/).check();
  const bajar = d.getByRole('button', { name: /Descargar \(/ });
  if (await bajar.count()) {
    const t0 = Date.now();
    await bajar.click();
    await expect(bajar).toHaveCount(0, { timeout: 1_800_000 });
    console.log('EmbeddingGemma 2 descargado en', Math.round((Date.now() - t0) / 1000), 's');
  }
  await d.getByRole('radio', { name: '256' }).click();
  await d.getByLabel('En una copia nueva').check();
  let t0 = Date.now();
  await d.getByRole('button', { name: 'Empezar' }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0, { timeout: 1_800_000 });
  console.log('revectorizado en', Math.round((Date.now() - t0) / 1000), 's');

  // Buscar por sentido: vectores compatibles con el modelo local, sin aviso.
  await page.keyboard.press('/');
  await page.getByRole('button', { name: 'Semántica' }).click();
  await page.locator('#q').fill('she is not allowed to work or write');
  t0 = Date.now();
  await page.locator('#q').press('Enter');
  await expect(page.locator('.resultado').first()).toBeVisible({ timeout: 600_000 });
  console.log('primera búsqueda semántica (con carga del modelo) en', Date.now() - t0, 'ms');
  await expect(page.locator('.aviso-busqueda')).toHaveCount(0);
  await expect(page.locator('.resultado .sello.azul').first()).toHaveText('Semántica');
  console.log('primer resultado:', (await page.locator('.resultado .cita').first().textContent()), (await page.locator('.resultado .fragmento').first().textContent())?.slice(0, 120));
  await page.screenshot({ path: resolve(CAPTURAS, 'web-modelos-busqueda-semantica.png') });

  fase('preguntar');
  // Preguntar con Gemma 4 (se baja con un clic desde el panel).
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Preguntar', exact: true }).first().click();
  const panel = page.locator('.panel');
  await panel.getByLabel(/Gemma 4/).check();
  const bajarGen = panel.getByRole('button', { name: /Descargar \(/ });
  if (await bajarGen.count()) {
    t0 = Date.now();
    await bajarGen.click();
    await expect(panel.getByRole('button', { name: /Descargar \(|Descargando/ })).toHaveCount(0, { timeout: 3_000_000 });
    console.log('Gemma 4 descargado en', Math.round((Date.now() - t0) / 1000), 's');
  }
  fase('Gemma 4 listo');
  await page.locator('#pregunta').fill("Why does the narrator's husband forbid her to write?");
  t0 = Date.now();
  await panel.getByRole('button', { name: 'Preguntar' }).click();
  await expect(panel.locator('.afirmacion, [role=alert]').first().or(panel.getByText(/no contiene nada/))).toBeVisible({ timeout: 1_800_000 });
  console.log('respuesta en', Math.round((Date.now() - t0) / 1000), 's');
  const alerta = (await panel.locator('[role=alert]').count()) ? await panel.locator('[role=alert]').textContent() : null;
  if (alerta) console.log('alerta:', alerta);
  for (const a of await panel.locator('.afirmacion').all()) console.log('afirmación:', (await a.textContent())?.replace(/\s+/g, ' ').slice(0, 300));
  await page.screenshot({ path: resolve(CAPTURAS, 'web-modelos-preguntar.png') });
  expect(alerta).toBeNull();
});
