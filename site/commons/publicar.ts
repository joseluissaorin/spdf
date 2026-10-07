/**
 * Publica SPDF Commons: comprueba cada fichero (su SHA-256 y que spdf-format lo
 * da por válido), lo sube a R2 (spdf-web/commons/<fichero>) y copia el catálogo
 * a site/commons/catalogo.json, de donde salen la hoja /commons y el
 * manifiesto commons.spdfl.json.
 *
 *   npx tsx commons/publicar.ts [catalogo.json] [carpeta-de-los-spdf] [--sin-subir]
 *   (por defecto: ~/Developer/spdf-commons/catalogo.json y ~/Developer/spdf-commons/salida)
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate } from 'spdf-format';
import type { ObraCommons } from '../generador/commons';

const aqui = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const sinSubir = process.argv.includes('--sin-subir');
const catalogo = resolve(args[0] ?? join(homedir(), 'Developer/spdf-commons/catalogo.json'));
const carpeta = resolve(args[1] ?? join(dirname(catalogo), 'salida'));
const CUENTA = 'f22c7a728ddc8e41cefd2644f8fb7632';

const cat = JSON.parse(readFileSync(catalogo, 'utf8')) as { name: string; description: string; items: ObraCommons[] };
let bytes = 0;
for (const o of cat.items) {
  // Validar no basta: sin la comprobación de los folios a ojo, documentada, no se sube.
  if (!o.verificacion?.en || !o.verificacion?.es || !o.verificado) throw new Error(`${o.fichero}: falta cómo se verificaron sus folios (verificacion, verificado)`);
  const f = join(carpeta, o.fichero);
  const datos = readFileSync(f);
  const sha = createHash('sha256').update(datos).digest('hex');
  if (sha !== o.sha256) throw new Error(`${o.fichero}: el SHA-256 no coincide con el catálogo`);
  if (statSync(f).size !== o.bytes) throw new Error(`${o.fichero}: el tamaño no coincide con el catálogo`);
  const r = await validate(new Uint8Array(datos));
  if (!r.valid) throw new Error(`${o.fichero}: no es válido (${r.errors.map((e) => e.code).join(', ')})`);
  bytes += datos.length;
  console.log(`${o.fichero}: válido${r.warnings.length ? ` (${r.warnings.map((w) => w.code).join(', ')})` : ''}, ${(datos.length / 1048576).toFixed(1)} MB`);
  if (!sinSubir) {
    execFileSync('npx', ['wrangler', 'r2', 'object', 'put', `spdf-web/commons/${o.fichero}`, '--file', f, '--content-type', 'application/vnd.spdf', '--remote'], {
      cwd: resolve(aqui, '..'), stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: CUENTA },
    });
    console.log('   subido a R2');
  }
}
writeFileSync(resolve(aqui, 'catalogo.json'), `${JSON.stringify(cat, null, 2)}\n`);
console.log(`${cat.items.length} obras, ${(bytes / 1048576).toFixed(1)} MB; catálogo en site/commons/catalogo.json`);
