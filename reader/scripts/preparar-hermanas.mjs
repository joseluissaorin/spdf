#!/usr/bin/env node
/**
 * Antes de `npm run build:web`: compila las bibliotecas hermanas que usa el lector por
 * ruta (js/ → spdf-format, models/web → spdf-infer-web) si falta su dist o si sus
 * fuentes son más nuevas. Así la web publicada nunca lleva los simulacros.
 */
import { existsSync, statSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const masNuevo = (dir) => {
  let t = 0;
  const andar = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) andar(p); else t = Math.max(t, statSync(p).mtimeMs); } };
  if (existsSync(dir)) andar(dir);
  return t;
};
for (const [carpeta, dist] of [['js', 'dist/entry/browser.js'], ['models/web', 'dist/index.js']]) {
  const d = join(raiz, carpeta);
  if (!existsSync(join(d, 'package.json'))) { console.log(`[hermanas] ${carpeta}: no está en el repositorio`); continue; }
  const salida = join(d, dist);
  const viejo = !existsSync(salida) || masNuevo(join(d, 'src')) > statSync(salida).mtimeMs;
  if (!viejo) { console.log(`[hermanas] ${carpeta}: al día`); continue; }
  console.log(`[hermanas] ${carpeta}: compilando…`);
  execSync('npm ci --silent && npm run build --silent', { cwd: d, stdio: 'inherit' });
}
