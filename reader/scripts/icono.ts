/**
 * Exporta el icono del lector (src/dibujo/dibujos/icono.ts) a todo lo que piden
 * las plataformas:
 *   - public/icono.svg            favicon y PWA (vectorial)
 *   - public/icono-192.png, -512.png, -maskable-512.png   PWA
 *   - iconos/icono-1024.png       a sangre: fuente para `tauri icon` (iOS, Android, Windows, Linux)
 *   - iconos/icono-mac-1024.png   placa redondeada con margen y sombra (macOS no recorta)
 * Las formas planas se imprimen con mezcla normal: el recorte de papel de la
 * mano tiene que tapar el disco rojo (en la interfaz multiplican, aquí no).
 *
 *   npx tsx scripts/icono.ts
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { aSvg } from '../src/dibujo/boceto';
import { icono } from '../src/dibujo/dibujos/icono';

const aqui = dirname(fileURLToPath(import.meta.url));
const raiz = resolve(aqui, '..');
const TINTAS = { papel: '#F5F0E8', tinta: '#2C1810', lapiz: '#9A8E80', rojo: '#C1453B', azul: '#2B4C7E', amarillo: '#E8A838', oro: '#D6A03A', negro: '#1A120D' };
const vars = Object.entries(TINTAS).map(([k, v]) => `--d-${k}:${v}`).join(';');
const svg = aSvg(icono, { lengua: 'es', decorativo: true }).replace(/^(<svg[^>]*>)/, `$1<style>svg{${vars}}.c-pl,.c-co,.c-en{mix-blend-mode:normal}</style>`)
  .replace(/class="dibujo[^"]*"/, 'class="dibujo"');

mkdirSync(resolve(raiz, 'iconos'), { recursive: true });
writeFileSync(resolve(raiz, 'public/icono.svg'), svg);
const html = resolve(raiz, 'iconos/.icono.html');
writeFileSync(html, `<!doctype html><style>html,body{margin:0;background:${TINTAS.papel};overflow:hidden}svg{width:512px;height:512px;display:block}</style>${svg}`);
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const base = resolve(raiz, 'iconos/icono-1024.png');
execFileSync(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=2', '--window-size=512,512', `--screenshot=${base}`, pathToFileURL(html).href], { stdio: 'ignore' });

const m = (...a: string[]) => execFileSync('magick', a, { stdio: 'inherit' });
// Grano de papel, leve: el icono también es papel impreso.
m(base, '(', '+clone', '-fill', 'gray50', '-colorize', '100', '-attenuate', '0.35', '+noise', 'Gaussian', '-colorspace', 'gray', ')',
  '-compose', 'soft-light', '-composite', '-resize', '1024x1024!', base);
// macOS: placa de 824 con esquinas de 185 (la retícula de Apple), centrada, con sombra.
const mac = resolve(raiz, 'iconos/icono-mac-1024.png');
const placa = resolve(raiz, 'iconos/.placa.png');
m(base, '-resize', '824x824', '(', '-size', '824x824', 'xc:black', '-fill', 'white', '-draw', 'roundrectangle 0,0 823,823 185,185', ')',
  '-alpha', 'off', '-compose', 'CopyOpacity', '-composite', placa);
m('-size', '1024x1024', 'xc:none', '(', placa, '-background', 'black', '-shadow', '30x12+0+0', ')', '-gravity', 'center', '-geometry', '+0+10', '-composite',
  placa, '-gravity', 'center', '-composite', mac);
for (const n of [192, 512]) m(base, '-resize', `${n}x${n}`, resolve(raiz, `public/icono-${n}.png`));
// Maskable: el dibujo dentro de la zona segura (80 %), con papel alrededor.
m(base, '-resize', '410x410', '-background', TINTAS.papel, '-gravity', 'center', '-extent', '512x512', resolve(raiz, 'public/icono-maskable-512.png'));
console.log('iconos listos');
