/**
 * Las descargas del Lector SPDF. Mientras el repositorio sea privado, los
 * binarios de las releases de GitHub (etiqueta reader-v<versión>) no se pueden
 * descargar sin sesión, así que se copian a R2 (reader/<versión>/<fichero>) y
 * se sirven desde /download/files/… El inventario vive en site/descargas.json.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ORIGEN, SITIO, esc, type Lengua } from './sitio';
import type { Bloque } from './construir';
import { megas } from './commons';

interface Fichero { plataforma: string; nombre: string; bytes: number; sha256: string; clave: string }
interface Inventario { version: string | null; files: Fichero[] }

/** Avisos honestos sobre la firma de cada plataforma (mientras no haya certificados de distribución). */
const AVISOS: Record<string, Record<Lengua, string>> = {
  macos: { en: 'Signed ad hoc, not notarised: the first time, right-click the app and choose Open.', es: 'Firmado ad hoc, sin notarizar: la primera vez, clic derecho sobre la aplicación y Abrir.' },
  windows: { en: 'Not signed with Authenticode: SmartScreen will warn; choose More info, then Run anyway.', es: 'Sin firma de Authenticode: SmartScreen avisará; «Más información» y «Ejecutar de todas formas».' },
  linux: { en: 'Needs WebKitGTK 4.1 (Ubuntu 22.04 or later).', es: 'Necesita WebKitGTK 4.1 (Ubuntu 22.04 o posterior).' },
  android: { en: 'Allow installing apps from this source when Android asks. No local models in this version: semantic search uses Gemini with your own key.', es: 'Permite instalar aplicaciones de este origen cuando Android lo pida. Sin modelos locales en esta versión: la búsqueda semántica usa Gemini con tu clave.' },
};

const PLATAFORMAS: { id: string; nombre: Record<Lengua, string>; detalle: Record<Lengua, string> }[] = [
  { id: 'macos', nombre: { en: 'macOS', es: 'macOS' }, detalle: { en: 'Apple silicon, .dmg', es: 'Apple silicon, .dmg' } },
  { id: 'windows', nombre: { en: 'Windows', es: 'Windows' }, detalle: { en: 'Windows 10 and 11, .exe installer or .msi', es: 'Windows 10 y 11, instalador .exe o .msi' } },
  { id: 'linux', nombre: { en: 'Linux', es: 'Linux' }, detalle: { en: 'AppImage and .deb, x64', es: 'AppImage y .deb, x64' } },
  { id: 'android', nombre: { en: 'Android', es: 'Android' }, detalle: { en: '.apk, Android 8.0 or later', es: '.apk, Android 8.0 o posterior' } },
  { id: 'ios', nombre: { en: 'iOS and iPadOS', es: 'iOS y iPadOS' }, detalle: { en: 'TestFlight, not yet', es: 'TestFlight, todavía no' } },
];

export function descargasBloque(l: Lengua, hayLector: boolean): Bloque {
  const inv = JSON.parse(readFileSync(resolve(SITIO, 'descargas.json'), 'utf8')) as Inventario;
  const pronto = l === 'es' ? 'En preparación' : 'Coming soon';
  const tarjetas = PLATAFORMAS.map((p) => {
    const fs = inv.files.filter((f) => f.plataforma === p.id);
    const enlaces = fs.length
      ? fs.map((f) => `<a href="/download/files/${f.clave}" download>${esc(f.nombre)}</a> <span class="rotulo">${megas(f.bytes)}</span>`).join('<br>')
      : `<span class="estado">${pronto}</span>`;
    const aviso = fs.length && AVISOS[p.id] ? `<span class="rotulo">${AVISOS[p.id]![l]}</span>` : '';
    return `<li><strong>${p.nombre[l]}</strong><span>${p.detalle[l]}</span>${enlaces}${aviso}</li>`;
  });
  tarjetas.push(`<li><strong>Web</strong><span>${l === 'es' ? 'En cualquier navegador moderno' : 'In any modern browser'}</span>${hayLector ? `<a href="/reader/">${l === 'es' ? 'Abrir el lector web' : 'Open the web reader'}</a>` : `<span class="estado">${pronto}</span>`}</li>`);
  const version = inv.version ? `<p class="rotulo">${l === 'es' ? 'Versión' : 'Version'} ${esc(inv.version)}</p>` : '';
  const md = [
    ...(inv.version ? [`${l === 'es' ? 'Versión' : 'Version'} ${inv.version}`, ''] : []),
    ...PLATAFORMAS.map((p) => {
      const fs = inv.files.filter((f) => f.plataforma === p.id);
      return `- **${p.nombre[l]}** (${p.detalle[l]}): ${fs.length ? fs.map((f) => `${ORIGEN}/download/files/${f.clave} (${megas(f.bytes)}, sha256 ${f.sha256})`).join(', ') : pronto}`;
    }),
    `- **Web**: ${hayLector ? `${ORIGEN}/reader/` : pronto}`,
  ].join('\n');
  return { html: `${version}<ul class="descargas">${tarjetas.join('')}</ul>`, md };
}
