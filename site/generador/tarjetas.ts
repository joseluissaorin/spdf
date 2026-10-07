/**
 * Las imágenes fijas de la web: las tarjetas para redes (1200 × 630, en inglés
 * y en castellano), el icono en PNG para Apple y el favicon de 32 px. Se hacen
 * una vez con Chrome headless y se guardan en public/.
 *
 *   npx tsx generador/tarjetas.ts
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { aSvg } from '../dibujo/boceto';
import { folio } from '../dibujo/dibujos/folio';
import { SITIO } from './sitio';
import { TEXTOS } from './portada';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PUBLICO = resolve(SITIO, 'public');
const tmp = mkdtempSync(join(tmpdir(), 'spdf-tarjetas-'));
const mano = readFileSync(resolve(PUBLICO, 'fuentes/mano.woff2')).toString('base64');
const tintas = '--d-papel:#F5F0E8;--d-tinta:#2C1810;--d-lapiz:#9A8E80;--d-rojo:#C1453B;--d-azul:#2B4C7E;--d-amarillo:#E8A838;--d-oro:#D6A03A;--d-negro:#1A120D';

function captura(nombre: string, html: string, w: number, h: number, escala = 1): void {
  const f = join(tmp, `${nombre}.html`);
  writeFileSync(f, html);
  execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--force-device-scale-factor=${escala}`, `--window-size=${w},${h}`, `--screenshot=${resolve(PUBLICO, `${nombre}.png`)}`, pathToFileURL(f).href], { stdio: 'ignore' });
}

const base = `@font-face{font-family:Mano;src:url(data:font/woff2;base64,${mano}) format('woff2')}
*{box-sizing:border-box}html,body{margin:0}
body{background:#f5f0e8;color:#2c1810;font-family:Georgia,serif;${tintas}}
.nt{font-family:Mano,cursive}.c-pl,.c-co,.c-en{mix-blend-mode:multiply}`;

for (const l of ['en', 'es'] as const) {
  const t = TEXTOS[l];
  const html = `<!doctype html><meta charset="utf-8"><style>${base}
.t{position:relative;width:1200px;height:630px;overflow:hidden;background:#f5f0e8 repeating-linear-gradient(90deg,rgb(196 174 150/.22) 0 1px,transparent 1px 100px)}
.sol{position:absolute;width:560px;height:560px;border-radius:50%;background:#c1453b;right:-150px;bottom:-260px}
.hoja{position:absolute;left:calc(560px + 27.2% * 700 / 100);top:0}
.lamina{position:absolute;left:470px;top:76px;width:700px}
.lamina .papel{position:absolute;left:27.2%;top:8.6%;width:52.6%;height:86%;background:#faf7f0;box-shadow:0 10px 30px rgb(44 24 16/.12);clip-path:polygon(0 0,100% 0,100% 90.6%,94.6% 100%,0 100%)}
.lamina svg{position:relative;width:100%;height:auto;display:block}
.marca{position:absolute;left:64px;top:56px;font-size:34px;letter-spacing:.02em;display:flex;align-items:center;gap:14px}
.marca:before{content:'';width:26px;height:26px;background:#c1453b;transform:rotate(-4deg)}
.marca small{font:500 15px Menlo,monospace;color:#6f5546}
h1{position:absolute;left:60px;top:150px;margin:0;font-weight:normal;font-size:104px;line-height:.92;letter-spacing:-.035em;width:640px}
h1 em{color:#b3392f}
.pie{position:absolute;left:64px;bottom:50px;font:500 17px Menlo,monospace;letter-spacing:.06em;color:#6f5546}
</style><div class="t"><div class="sol"></div><div class="lamina"><div class="papel"></div>${aSvg(folio, { lengua: l, decorativo: true })}</div>
<div class="marca">SPDF <small>5.0</small></div><h1>${t.titular[0]}<br>${t.titular[1]}</h1>
<p class="pie">spdf.joseluissaorin.com · ${l === 'es' ? 'estándar abierto' : 'open standard'}</p></div>`;
  captura(`tarjeta-${l}`, html, 1200, 630);
}

const icono = (tam: number) => `<!doctype html><style>html,body{margin:0;background:#f5f0e8}
.i{width:${tam}px;height:${tam}px;display:grid;place-items:center;background:#f5f0e8}
.i span{width:58%;height:58%;background:#c1453b;transform:rotate(-4deg)}</style><div class="i"><span></span></div>`;
captura('apple-touch-icon', icono(180), 180, 180);
captura('favicon-32', icono(32), 32, 32);
writeFileSync(resolve(PUBLICO, 'favicon.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="4" fill="#f5f0e8"/><rect x="7" y="7" width="18" height="18" fill="#c1453b" transform="rotate(-4 16 16)"/></svg>\n`);
rmSync(tmp, { recursive: true, force: true });
console.log('tarjetas, iconos y favicon en public/');
