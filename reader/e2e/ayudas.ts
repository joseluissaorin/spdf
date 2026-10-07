/** Ayudas comunes de las pruebas: rutas de los ficheros, biblioteca limpia, importar y abrir. */
import { type Page, expect } from '@playwright/test';
import { existsSync, readdirSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

export const DATOS = resolve(import.meta.dirname, 'datos');
export const CONFORMIDAD = resolve(import.meta.dirname, '../../conformance');
export const CAPTURAS = resolve(import.meta.dirname, '../capturas');
mkdirSync(CAPTURAS, { recursive: true });

export const dato = (n: string) => resolve(DATOS, n);
export const hayDato = (n: string) => existsSync(dato(n));

/** Los .spdf de la batería de conformidad (5.0 en files/, 4.x en legacy/). */
export function ficherosConformidad(): string[] {
  const out: string[] = [];
  for (const d of ['files', 'legacy']) {
    const dir = resolve(CONFORMIDAD, d);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).sort()) if (/\.spdf(\.gz)?$/.test(f)) out.push(resolve(dir, f));
  }
  return out;
}

/** Arranca con OPFS y preferencias vacías (cada prueba, su biblioteca). */
export async function abrirLimpio(page: Page, q = '?pruebas') {
  page.on('pageerror', (e) => console.log('error de página:', e.message));
  await page.goto(`./${q}`);
  await page.evaluate(async () => {
    const r = await navigator.storage.getDirectory();
    try { await r.removeEntry('spdf-lector', { recursive: true }); } catch { /* no había nada */ }
    localStorage.clear();
  });
  await page.goto(`./${q}#/`);
  await page.reload();
  await expect(page.locator('.barra')).toBeVisible();
}

export async function importar(page: Page, rutas: string[]) {
  await page.locator('input[type=file][accept^=".spdf,"]').setInputFiles(rutas);
}

/** Importa uno y espera a que se abra (con un solo fichero, se abre solo). */
export async function importarYAbrir(page: Page, ruta: string) {
  await importar(page, [ruta]);
  await expect(page.locator('.hoja, .transcripcion article').first()).toBeVisible({ timeout: 30_000 });
}

export async function volverABiblioteca(page: Page) {
  await page.getByRole('button', { name: 'Volver a la biblioteca' }).click();
  await expect(page.locator('.estante')).toBeVisible();
}

export const portapapeles = (page: Page) => page.evaluate(() => navigator.clipboard.readText());
