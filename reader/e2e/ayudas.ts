/** Ayudas comunes de las pruebas: rutas de los ficheros y una importación por el <input>. */
import { type Page, expect } from '@playwright/test';
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

export const DATOS = resolve(import.meta.dirname, 'datos');
export const CONFORMIDAD = resolve(import.meta.dirname, '../../conformance');
export const CAPTURAS = resolve(import.meta.dirname, '../capturas');

/** Los .spdf de la batería de conformidad (si está en el repositorio). */
export function ficherosConformidad(): string[] {
  const out: string[] = [];
  for (const d of ['files', 'legacy']) {
    const dir = resolve(CONFORMIDAD, d);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) if (/\.spdf(\.gz)?$/.test(f)) out.push(resolve(dir, f));
  }
  return out;
}

export async function abrirLimpio(page: Page, q = '?pruebas') {
  await page.goto(`./${q}`);
  // Biblioteca limpia: OPFS vacío para cada prueba.
  await page.evaluate(async () => {
    const r = await navigator.storage.getDirectory();
    try { await r.removeEntry('spdf-lector', { recursive: true }); } catch { /* no había nada */ }
    localStorage.clear();
  });
  await page.goto(`./${q}#/`);
  await page.reload();
}

export async function importar(page: Page, rutas: string[]) {
  const input = page.locator('input[type=file][accept*=".spdf"]');
  await input.setInputFiles(rutas);
}

export async function esperarBiblioteca(page: Page, n: number) {
  await expect(page.locator('.ficha-libro')).toHaveCount(n, { timeout: 30_000 });
}
