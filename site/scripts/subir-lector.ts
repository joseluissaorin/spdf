/**
 * Publica los binarios del Lector SPDF en la web. Mientras el repositorio sea
 * privado, los ficheros de una release de GitHub no se pueden descargar sin
 * sesión, así que se bajan con `gh`, se suben a R2 (spdf-web/reader/<versión>/)
 * y se anotan en site/descargas.json, de donde sale /download.
 *
 *   npx tsx scripts/subir-lector.ts reader-v0.1.0 [--sin-subir]
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));
const etiqueta = process.argv[2];
if (!etiqueta || !/^reader-v\d+\.\d+\.\d+/.test(etiqueta)) {
  console.error('Uso: npx tsx scripts/subir-lector.ts reader-v<versión> [--sin-subir]');
  process.exit(2);
}
const version = etiqueta.replace(/^reader-v/, '');
const sinSubir = process.argv.includes('--sin-subir');

/** De qué plataforma es cada fichero, por su nombre (los nombres los fija .github/workflows/reader.yml). */
function plataforma(f: string): string | null {
  if (/\.dmg$/i.test(f)) return 'macos';
  if (/\.(msi|exe)$/i.test(f)) return 'windows';
  if (/\.(AppImage|deb|rpm)$/i.test(f)) return 'linux';
  if (/\.(apk|aab)$/i.test(f)) return 'android';
  return null;
}

const dir = mkdtempSync(join(tmpdir(), 'spdf-lector-'));
try {
  execFileSync('gh', ['release', 'download', etiqueta, '-R', 'joseluissaorin/spdf', '-D', dir], { stdio: 'inherit' });
  const files = [];
  for (const f of readdirSync(dir).sort()) {
    const p = plataforma(f);
    if (!p) { console.log(`(se omite ${f})`); continue; }
    const datos = readFileSync(join(dir, f));
    const sha256 = createHash('sha256').update(datos).digest('hex');
    const clave = `${version}/${f}`;
    if (!sinSubir) {
      execFileSync('npx', ['wrangler', 'r2', 'object', 'put', `spdf-web/reader/${clave}`, '--file', join(dir, f), '--remote'], {
        cwd: resolve(aqui, '..'), stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: 'f22c7a728ddc8e41cefd2644f8fb7632' },
      });
    }
    files.push({ plataforma: p, nombre: f, bytes: datos.length, sha256, clave });
    console.log(`${p}: ${f} (${(datos.length / 1048576).toFixed(1)} MB)${sinSubir ? '' : ', subido'}`);
  }
  writeFileSync(resolve(aqui, '../descargas.json'), `${JSON.stringify({ version, files }, null, 2)}\n`);
  console.log(`descargas.json: versión ${version}, ${files.length} ficheros`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
