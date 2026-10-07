/**
 * Lo fijo de la web: el origen, el autor, las rutas de cada hoja en las dos
 * lenguas, los textos de la interfaz y el registro de implementaciones.
 *
 * El inglés va en la raíz y el castellano bajo /es: la especificación normativa
 * está en inglés y el público del estándar es internacional; la traducción
 * española es fiel y completa (SPEC.es.md), no un resumen.
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export type Lengua = 'en' | 'es';
export const LENGUAS: Lengua[] = ['en', 'es'];
export const OTRA: Record<Lengua, Lengua> = { en: 'es', es: 'en' };

/** El origen de este despliegue (SPDF_ORIGEN al construir para otro sitio). */
export const ORIGEN = process.env.SPDF_ORIGEN || 'https://spdf.joseluissaorin.com';
export const AUTOR = { nombre: 'José Luis Saorín Ferrer', web: 'https://joseluissaorin.com', correo: 'jl@joseluissaorin.com' };
export const REPO = 'https://github.com/joseluissaorin/spdf';
/** Mientras el repositorio sea privado, la web no enlaza a GitHub (serían enlaces rotos para el público). */
export const REPO_PUBLICO = process.env.SPDF_REPO_PUBLICO === '1';
export const VERSION = '5.0';
export const PUBLICADO = '2026-10-07';

const aqui = dirname(fileURLToPath(import.meta.url));
/** La raíz del monorepo y la de la web. */
export const RAIZ = resolve(aqui, '../..');
export const SITIO = resolve(aqui, '..');

// ---------------------------------------------------------------------------
// Las hojas
// ---------------------------------------------------------------------------

export type Clave =
  | 'inicio' | 'spec' | 'implementaciones' | 'docs' | 'validador' | 'descargas' | 'commons'
  | 'integraciones' | 'gobernanza' | 'citar' | 'agentes';

export const RUTAS: Record<Clave, Record<Lengua, string>> = {
  inicio: { en: '/', es: '/es' },
  spec: { en: '/spec', es: '/es/especificacion' },
  implementaciones: { en: '/implementations', es: '/es/implementaciones' },
  docs: { en: '/docs', es: '/es/documentacion' },
  validador: { en: '/validator', es: '/es/validador' },
  descargas: { en: '/download', es: '/es/descargas' },
  commons: { en: '/commons', es: '/es/commons' },
  integraciones: { en: '/integrations', es: '/es/integraciones' },
  gobernanza: { en: '/governance', es: '/es/gobernanza' },
  citar: { en: '/cite', es: '/es/citar' },
  agentes: { en: '/agents', es: '/es/agentes' },
};

/** El fichero HTML de una ruta (Cloudflare sirve /spec desde spec.html) y su gemelo .md. */
export const ficheroHtml = (ruta: string) => (ruta === '/' ? 'index.html' : `${ruta.slice(1)}.html`);
export const rutaMd = (ruta: string) => (ruta === '/' ? '/index.md' : `${ruta}.md`);

/** La navegación principal, en orden. */
export const NAV: Clave[] = ['spec', 'implementaciones', 'docs', 'validador', 'descargas', 'commons', 'citar'];

export const UI = {
  en: {
    saltar: 'Skip to content', principal: 'Main', pie: 'Footer', otra: 'Español', otraTitulo: 'Lee esta página en español',
    nav: { inicio: 'Home', spec: 'Specification', implementaciones: 'Implementations', docs: 'Docs', validador: 'Validator', descargas: 'Download', commons: 'Commons', integraciones: 'Integrations', gobernanza: 'Governance', citar: 'Cite', agentes: 'Agents' } as Record<Clave, string>,
    lector: 'Reader',
    enEsta: 'On this page', revisado: 'Reviewed', markdown: 'Markdown', copiar: 'Copy', copiado: 'Copied',
    lema: 'documents read once, cited forever',
    licencia: 'Specification and documentation under CC BY 4.0. Code under MIT or Apache-2.0. No patent claims, ever.',
    borrador: 'Working draft',
    paraMaquinas: 'For machines',
  },
  es: {
    saltar: 'Saltar al contenido', principal: 'Principal', pie: 'Pie', otra: 'English', otraTitulo: 'Read this page in English',
    nav: { inicio: 'Inicio', spec: 'Especificación', implementaciones: 'Implementaciones', docs: 'Documentación', validador: 'Validador', descargas: 'Descargas', commons: 'Commons', integraciones: 'Integraciones', gobernanza: 'Gobernanza', citar: 'Citar', agentes: 'Agentes' } as Record<Clave, string>,
    lector: 'Lector',
    enEsta: 'En esta página', revisado: 'Revisado', markdown: 'Markdown', copiar: 'Copiar', copiado: 'Copiado',
    lema: 'documentos leídos una vez, citables siempre',
    licencia: 'Especificación y documentación con licencia CC BY 4.0. Código con licencia MIT o Apache-2.0. Sin reclamaciones de patentes, nunca.',
    borrador: 'Borrador de trabajo',
    paraMaquinas: 'Para máquinas',
  },
} as const;

// ---------------------------------------------------------------------------
// Las implementaciones
// ---------------------------------------------------------------------------

export interface Implementacion {
  id: string;
  /** Carpeta del monorepo y nombre de su workflow (.github/workflows/<carpeta>.yml). */
  carpeta: string;
  nombre: string;
  nivel: 1 | 2;
  paquete: string;
  instalar: string;
  registro?: { nombre: string; url: string };
  nota: Record<Lengua, string>;
}

export const IMPLEMENTACIONES: Implementacion[] = [
  { id: 'rust', carpeta: 'rust', nombre: 'Rust', nivel: 1, paquete: 'spdf', instalar: 'cargo add spdf', registro: { nombre: 'crates.io', url: 'https://crates.io/crates/spdf' },
    nota: { en: 'Reference implementation; also provides the C ABI.', es: 'Implementación de referencia; da además la ABI de C.' } },
  { id: 'js', carpeta: 'js', nombre: 'TypeScript', nivel: 1, paquete: 'spdf-format', instalar: 'npm install spdf-format', registro: { nombre: 'npm', url: 'https://www.npmjs.com/package/spdf-format' },
    nota: { en: 'Node (node:sqlite), Bun and the browser (sqlite-wasm). Powers the validator on this site.', es: 'Node (node:sqlite), Bun y el navegador (sqlite-wasm). Es la que mueve el validador de esta web.' } },
  { id: 'python', carpeta: 'python', nombre: 'Python', nivel: 1, paquete: 'spdf-format', instalar: 'pip install spdf-format', registro: { nombre: 'PyPI', url: 'https://pypi.org/project/spdf-format/' },
    nota: { en: 'Standard library sqlite3 only; imported as spdf.', es: 'Solo sqlite3 de la biblioteca estándar; se importa como spdf.' } },
  { id: 'swift', carpeta: 'swift', nombre: 'Swift', nivel: 1, paquete: 'SPDF', instalar: '.package(url: "https://github.com/joseluissaorin/spdf", from: "5.0.0")',
    nota: { en: 'Swift Package Manager, from the repository. Apple platforms and Linux.', es: 'Swift Package Manager, desde el repositorio. Plataformas de Apple y Linux.' } },
  { id: 'kotlin', carpeta: 'kotlin', nombre: 'Kotlin / JVM', nivel: 1, paquete: 'io.github.joseluissaorin:spdf', instalar: 'implementation("io.github.joseluissaorin:spdf:5.0.0")', registro: { nombre: 'Maven Central', url: 'https://central.sonatype.com/artifact/io.github.joseluissaorin/spdf' },
    nota: { en: 'Kotlin and Java on the JVM and Android.', es: 'Kotlin y Java sobre la JVM y Android.' } },
  { id: 'go', carpeta: 'go', nombre: 'Go', nivel: 1, paquete: 'github.com/joseluissaorin/spdf/go', instalar: 'go get github.com/joseluissaorin/spdf/go', registro: { nombre: 'pkg.go.dev', url: 'https://pkg.go.dev/github.com/joseluissaorin/spdf/go' },
    nota: { en: 'Go module in the monorepo.', es: 'Módulo de Go dentro del monorepo.' } },
  { id: 'dotnet', carpeta: 'dotnet', nombre: 'C# / .NET', nivel: 1, paquete: 'Spdf.Format', instalar: 'dotnet add package Spdf.Format', registro: { nombre: 'NuGet', url: 'https://www.nuget.org/packages/Spdf.Format' },
    nota: { en: '.NET with Microsoft.Data.Sqlite.', es: '.NET con Microsoft.Data.Sqlite.' } },
  { id: 'php', carpeta: 'php', nombre: 'PHP', nivel: 2, paquete: 'joseluissaorin/spdf', instalar: 'composer require joseluissaorin/spdf', registro: { nombre: 'Packagist', url: 'https://packagist.org/packages/joseluissaorin/spdf' },
    nota: { en: 'PDO SQLite.', es: 'PDO SQLite.' } },
  { id: 'ruby', carpeta: 'ruby', nombre: 'Ruby', nivel: 2, paquete: 'spdf-format', instalar: 'gem install spdf-format', registro: { nombre: 'RubyGems', url: 'https://rubygems.org/gems/spdf-format' },
    nota: { en: 'On the sqlite3 gem.', es: 'Sobre la gema sqlite3.' } },
  { id: 'r', carpeta: 'r', nombre: 'R', nivel: 2, paquete: 'spdf', instalar: 'remotes::install_github("joseluissaorin/spdf", subdir = "r")',
    nota: { en: 'On RSQLite; fragments as data frames.', es: 'Sobre RSQLite; los fragmentos como data frames.' } },
  { id: 'julia', carpeta: 'julia', nombre: 'Julia', nivel: 2, paquete: 'SPDF.jl', instalar: 'pkg> add SPDF',
    nota: { en: 'On SQLite.jl.', es: 'Sobre SQLite.jl.' } },
  { id: 'c', carpeta: 'c', nombre: 'C', nivel: 2, paquete: 'libspdf', instalar: '#include "spdf.h"  /* link with -lspdf */',
    nota: { en: 'C ABI over the Rust core, for C, C++ and any FFI.', es: 'ABI de C sobre el núcleo de Rust, para C, C++ y cualquier FFI.' } },
];

/** Las integraciones del ecosistema (integrations/<carpeta>), cada una con su README. */
export const INTEGRACIONES: { id: string; carpeta: string; nombre: Record<Lengua, string>; resumen: Record<Lengua, string> }[] = [
  { id: 'mcp', carpeta: 'spdf-mcp', nombre: { en: 'MCP server: spdf-mcp', es: 'Servidor MCP: spdf-mcp' }, resumen: { en: 'Any agent searches a folder of SPDF files and cites with the exact folio.', es: 'Cualquier agente busca en una carpeta de SPDF y cita con el folio exacto.' } },
  { id: 'langchain-js', carpeta: 'langchain-js', nombre: { en: 'LangChain.js loader', es: 'Cargador de LangChain.js' }, resumen: { en: 'Passages as LangChain documents with citation and anchor URI.', es: 'Pasajes como documentos de LangChain con su cita y su URI de ancla.' } },
  { id: 'llamaindex-js', carpeta: 'llamaindex-js', nombre: { en: 'LlamaIndex.TS reader', es: 'Lector de LlamaIndex.TS' }, resumen: { en: 'Passages as LlamaIndex documents, with the stored vectors if you want them.', es: 'Pasajes como documentos de LlamaIndex, con los vectores guardados si los quieres.' } },
  { id: 'langchain-python', carpeta: 'langchain-python', nombre: { en: 'LangChain loader (Python)', es: 'Cargador de LangChain (Python)' }, resumen: { en: 'The same loader for LangChain in Python.', es: 'El mismo cargador para LangChain en Python.' } },
  { id: 'llamaindex-python', carpeta: 'llamaindex-python', nombre: { en: 'LlamaIndex reader (Python)', es: 'Lector de LlamaIndex (Python)' }, resumen: { en: 'The same reader for LlamaIndex in Python.', es: 'El mismo lector para LlamaIndex en Python.' } },
  { id: 'zotero', carpeta: 'zotero', nombre: { en: 'Zotero 7 and 8 plugin', es: 'Complemento para Zotero 7 y 8' }, resumen: { en: 'Import an SPDF as an item, attach it, copy a citation with the folio.', es: 'Importa un SPDF como ítem, adjúntalo y copia una cita con el folio.' } },
  { id: 'pandoc', carpeta: 'pandoc', nombre: { en: 'Pandoc filter', es: 'Filtro de Pandoc' }, resumen: { en: 'SPDF anchors in Markdown become citations with the printed folio, in any CSL style.', es: 'Las anclas de SPDF en Markdown se convierten en citas con el folio impreso, en cualquier estilo CSL.' } },
];

/** Las otras piezas del repositorio que también tienen CI. */
export const OTRAS_PIEZAS = [
  { id: 'producer', carpeta: 'producer', nombre: { en: 'Reference producer (spdf build)', es: 'Productor de referencia (spdf build)' } },
  { id: 'reader', carpeta: 'reader', nombre: { en: 'SPDF Reader', es: 'Lector SPDF' } },
  { id: 'conformance', carpeta: 'conformance', nombre: { en: 'Conformance suite', es: 'Batería de conformidad' } },
  { id: 'integrations', carpeta: 'integrations', nombre: { en: 'Integrations', es: 'Integraciones' } },
  { id: 'site', carpeta: 'site', nombre: { en: 'This site', es: 'Esta web' } },
];

export const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
