/**
 * Mediciones de la versión web (Chromium sin cabeza, build de producción):
 * arranque en frío y en caliente, importar y abrir un libro grande, pasar
 * página, ir a un folio y buscar (en el documento y en la biblioteca).
 *
 *   LIBRO_245=/ruta/libro.spdf[,/ruta/otro.spdf] npx playwright test e2e/rendimiento.spec.ts
 *
 * Sin LIBRO_245 se mide con el Quijote de prueba (9 páginas). Los resultados
 * se escriben en e2e/rendimiento-web.json y se resumen en RENDIMIENTO.md.
 */
import { test, expect, type Page } from '@playwright/test';
import { abrirLimpio, importar, dato, ficherosConformidad } from './ayudas';
import { writeFileSync, readFileSync, existsSync, statSync } from 'node:fs';
import { basename, resolve } from 'node:path';

const libros = (process.env.LIBRO_245 ?? '').split(',').filter(Boolean);
// En la CI y en `npx playwright test` normal no se mide: solo con LIBRO_245 o RENDIMIENTO=1.
const medir = libros.length > 0 || process.env.RENDIMIENTO === '1';
const SALIDA = resolve(import.meta.dirname, 'rendimiento-web.json');
const mediana = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const r1 = (x: number) => Math.round(x * 10) / 10;

/** Tiempo (en la página, por fotograma) desde antes de `accion` hasta que se cumple `cond`. */
async function cronometrar(page: Page, accion: () => Promise<unknown>, cond: string, timeout = 120_000): Promise<number> {
  const t0 = await page.evaluate(() => performance.now());
  await accion();
  await page.waitForFunction(cond, undefined, { polling: 'raf', timeout });
  return r1((await page.evaluate(() => performance.now())) - t0);
}
const TEXTO_VISIBLE = `!!document.querySelector('.hoja article, .hoja p.apagado')`;

async function marca(page: Page, n: string): Promise<number | null> {
  return page.evaluate((m) => performance.getEntriesByName(m).at(-1)?.startTime ?? null, n);
}
async function medida(page: Page, n: string): Promise<number | null> {
  return page.evaluate((m) => performance.getEntriesByName(m, 'measure').at(-1)?.duration ?? null, n);
}

test.describe.configure({ mode: 'serial' });
// waitForFunction evalúa texto: la CSP de producción lo prohíbe (y está bien que lo prohíba).
test.use({ bypassCSP: true });

for (const ruta of libros.length ? libros : [dato('quijote-cap1.spdf')]) {
  test(`rendimiento web: ${basename(ruta)}`, async ({ page }) => {
    test.skip(!medir, 'mediciones solo bajo demanda (LIBRO_245 o RENDIMIENTO=1)');
    test.setTimeout(300_000);
    const r: Record<string, unknown> = { fichero: basename(ruta), bytes: statSync(ruta).size, navegador: 'Chromium (Playwright, sin cabeza)', fecha: new Date().toISOString() };

    // Arranque en frío: sin caché HTTP ni OPFS.
    await abrirLimpio(page);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.clearBrowserCache');
    await page.reload();
    await expect(page.locator('.barra')).toBeVisible();
    r.arranque_frio_ms = r1((await marca(page, 'spdf:interfaz'))!);

    // Importar (huella SHA-256, copia a OPFS, apertura) hasta ver la primera página.
    r.importar_y_abrir_ms = await cronometrar(page, () => importar(page, [ruta]), TEXTO_VISIBLE);
    let t = 0;
    const total = Number((await page.locator('.folio-nav .total').textContent())!.split('/')[1]);
    r.unidades = total;

    // Pasar página: 20 veces, mediana del tiempo hasta que cambia el texto.
    const pasos: number[] = [];
    for (let i = 0; i < Math.min(20, total - 1); i++) {
      const antes = await page.locator('.hoja').getAttribute('data-unidad', { timeout: 10_000 });
      t = performance.now();
      await page.keyboard.press('ArrowRight');
      await expect(page.locator('.hoja')).not.toHaveAttribute('data-unidad', antes ?? '', { timeout: 10_000 });
      pasos.push(performance.now() - t);
      if (i === 0) await page.waitForTimeout(50);
    }
    r.pasar_pagina_mediana_ms = r1(mediana(pasos));

    // Ir a un folio impreso cercano a la mitad.
    const folio = total >= 200 ? '145' : '3';
    await page.locator('#folio').fill(folio);
    r.ir_a_folio_ms = await cronometrar(page, () => page.locator('#folio').press('Enter'), `document.querySelector('.hoja .margen .folio')?.textContent === ${JSON.stringify(folio)}`, 10_000);
    r.folio = folio;

    // Abrir de nuevo desde la biblioteca (documento ya en OPFS, caché del worker vacía tras recargar).
    await page.goto('./?pruebas#/');
    await page.reload();
    await expect(page.locator('.ficha-libro')).toHaveCount(1);
    r.arranque_caliente_ms = r1((await marca(page, 'spdf:interfaz'))!);
    // El clic se da desde la página: el de Playwright espera a que acabe la animación de entrada de la ficha.
    await page.locator('.ficha-libro').first().waitFor();
    r.abrir_desde_biblioteca_ms = await cronometrar(page, () => page.evaluate(() => (document.querySelector('.ficha-libro') as HTMLElement).click()), TEXTO_VISIBLE);
    r.apertura_hasta_texto_ms = r1((await medida(page, 'spdf:apertura')) ?? NaN);

    // Buscar en el documento: varias consultas, tiempo del worker y de punta a punta.
    const consultas = total >= 200 ? ['astronomy', 'Ptolemy', 'medieval model', '"the discarded image"', 'angels heaven'] : ['hidalgo', 'Mancha', 'lantejas', 'caballero andante', 'Rocinante'];
    await page.keyboard.press('/');
    const busq: { q: string; n: number; worker_ms: number; total_ms: number }[] = [];
    for (const q of consultas) {
      // Se vacía la lista antes, para medir de verdad la llegada de la nueva.
      await page.locator('#q').fill('');
      await page.waitForFunction(`!document.querySelector('.panel .susurro')`, undefined, { polling: 'raf' }).catch(() => {});
      const total = await cronometrar(page, async () => { await page.locator('#q').fill(q); await page.locator('#q').press('Enter'); },
        `/\\d+ resultados/.test(document.querySelector('.panel .susurro')?.textContent ?? '')`, 30_000);
      const m = /(\d+) resultados en (\d+) ms/.exec((await page.locator('.panel .susurro').textContent())!);
      busq.push({ q, n: Number(m?.[1] ?? 0), worker_ms: Number(m?.[2] ?? NaN), total_ms: total });
    }
    r.busqueda_documento = busq;
    r.busqueda_documento_mediana_ms = mediana(busq.map((b) => b.worker_ms));

    // Buscar en toda la biblioteca: con los 9 ficheros de conformidad además del libro.
    await page.goto('./?pruebas#/');
    await importar(page, ficherosConformidad());
    await expect(page.locator('.ficha-libro')).toHaveCount(1 + ficherosConformidad().length, { timeout: 60_000 });
    const bib: { q: string; n: number; worker_ms: number }[] = [];
    for (const q of consultas.slice(0, 3)) {
      const previo = (await page.locator('.panel .susurro').count()) ? await page.locator('.panel .susurro').textContent() : '';
      await page.locator('#q-biblioteca').fill(q);
      await page.locator('#q-biblioteca').press('Enter');
      await expect(page.locator('.panel .susurro')).toContainText(/\d+ resultados/, { timeout: 30_000 });
      if (previo) await expect(page.locator('.panel .susurro')).not.toHaveText(previo, { timeout: 3000 }).catch(() => {});
      const m = /(\d+) resultados en (\d+) ms/.exec((await page.locator('.panel .susurro').textContent())!);
      bib.push({ q, n: Number(m?.[1] ?? 0), worker_ms: Number(m?.[2] ?? NaN) });
    }
    r.busqueda_biblioteca = bib;
    r.documentos_biblioteca = 1 + ficherosConformidad().length;

    console.log(JSON.stringify(r, null, 1));
    const previo = existsSync(SALIDA) ? JSON.parse(readFileSync(SALIDA, 'utf8')) : {};
    previo[basename(ruta)] = r;
    writeFileSync(SALIDA, JSON.stringify(previo, null, 2) + '\n');
  });
}
