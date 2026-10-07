# Despliegue de la web de SPDF

La web del estándar vive en **https://spdf.joseluissaorin.com**. Es un Worker de
Cloudflare (`spdf-web`, cuenta `f22c7a728ddc8e41cefd2644f8fb7632`) con assets
estáticos (`site/dist`) y un cubo de R2 (`spdf-web`) para los ficheros grandes.
El dominio está en la misma cuenta y la ruta es un dominio personalizado del
Worker (`routes` en `wrangler.jsonc`); wrangler crea el registro DNS y el
certificado solo.

## Desplegar

```sh
site/scripts/desplegar.sh
```

El guion hace, en orden y parando si algo falla:

1. `js/`: `npm ci && npm run build` (spdf-format, que mueve el validador).
2. `reader/`: `npm ci && npm run build:web` (el lector web, que se publica en `/reader`).
3. `integrations/zotero/`: `npm ci && npm run build` (el `.xpi`, que se publica en `/zotero`).
4. `site/`: `npm ci`, `npm run build` (la web entera en `site/dist`) y `npm test`.
5. `npx wrangler deploy` (siempre `npx`, nunca `wrangler` a secas).
6. Comprueba con `curl` que responden `/`, `/es`, `/spec`, `/validator`,
   `/llms.txt`, `/sitemap.xml` y `/reader/`, y que `curl` a la raíz devuelve Markdown.

## Ningún SPDF que no valide, y en Commons ni siquiera eso basta

- `construir.ts` valida con spdf-format todos los `.spdf` de `public/` antes de
  escribir nada y para si uno falla. La copia rota de las pruebas
  (`integrations/fixtures/roto.spdf`) no se publica.
- El job «Todos los SPDF validan» del workflow `site` pasa por el validador de
  referencia (Rust, `spdf-tools`) y por el de spdf-format todos los `.spdf`
  versionados en `site/` e `integrations/` y todos los de SPDF Commons
  descargados de la web.
- Validar no basta: un folio puesto en la página equivocada pasa el validador.
  Cada obra de `commons/catalogo.json` lleva `verificacion` (en y es: qué
  páginas se miraron a ojo contra las imágenes o la transcripción, y qué se
  encontró) y `verificado` (fecha); sin eso, ni `construir.ts` publica la hoja
  ni `commons/publicar.ts` sube el fichero. La hoja de Commons lo enseña obra a
  obra, con un enlace para inspeccionarla en el validador (`/validator#url=…`).

Sin red (o sin `gh`), `SPDF_SIN_RED=1 site/scripts/desplegar.sh`: el estado del
CI sale de la última copia (`site/.cache/estado.json`) o como «sin datos».

Hay que desplegar desde un checkout al día de `main` (en este proyecto, el
worktree `~/Developer/spdf-worktrees/site-push`, rama `agente-site-push`,
después de `git pull --rebase origin main`): la web lee la especificación, los
README de cada implementación y de cada integración, la gobernanza, las RFC y
la tabla de clases de producto del README raíz del propio repositorio al
construir. Desde el 7 de octubre de 2026 el repositorio es público y la web
enlaza a GitHub (`SPDF_REPO_PUBLICO=0` lo evita).

## Qué se construye

`npm run build` ejecuta `generador/construir.ts`, que escribe en `site/dist`:

| Qué | De dónde sale |
| --- | --- |
| Portada (`/`, `/es`) | `generador/portada.ts` y la lámina `dibujo/dibujos/folio.ts` |
| Especificación (`/spec`, `/es/especificacion`) | `spec/SPEC.md` y `spec/SPEC.es.md` (si falta la traducción, el inglés con un aviso; si falta la especificación, `spec/CONTRACT.md`) |
| Implementaciones (`/implementations`) | `generador/sitio.ts` y el CI: con `gh`, el último run de `.github/workflows/<carpeta>.yml` en `main` y su artefacto `conformance-<carpeta>` |
| Documentación por lenguaje (`/docs/<id>`) | el `README.md` (o `README.es.md`) de cada carpeta |
| Integraciones (`/integrations/<id>`) | el `README.md` de cada carpeta de `integrations/` |
| Gobernanza y RFC (`/governance`) | `governance/*.md` y `spec/rfcs/NNNN-*.md`; si no hay, `contenido/*/gobernanza.md` |
| Validador (`/validator`) | `cliente/validador.ts` (2 KB) e `inspector.ts` (spdf-format y SQLite en WebAssembly, se descarga al soltar el primer fichero) |
| Muestras del validador (`/muestras/`) | `public/muestras/`, generadas por `muestras/generar.ts` |
| SPDF Commons (`/commons`) | `commons/catalogo.json`; los ficheros, en R2 |
| Descargas del lector (`/download`) | `descargas.json`; los binarios, en R2 |
| Lector web (`/reader/`) | `reader/dist-web`; sus cabeceras (COOP, COEP) se trasladan al `_headers` de la raíz |
| Complemento de Zotero (`/zotero/`) | `integrations/zotero/dist/*.xpi` y un `updates.json` con su SHA-256 (el `update_url` del manifiesto) |
| JSON Schema (`/schema/5.0/`) | `spec/json-schema/*.schema.json`, en la dirección de su `$id` |
| Para máquinas | `llms.txt`, `llms-full.txt` (la especificación entera y todas las hojas), `sitemap.xml`, `robots.txt`, `status.json`, `.well-known/security.txt` y un gemelo `.md` de cada hoja |

Los textos de cada hoja están en `contenido/en/*.md` y `contenido/es/*.md`
(cabecera YAML con `title`, `short` y `description`; los bloques dinámicos se
marcan con `<!-- nombre -->`).

## El Worker (`worker/index.ts`)

- Si la petición pide `Accept: text/markdown`, o la hace `curl`, `wget` o HTTPie,
  una hoja se responde con su gemelo `.md` (`?format=html` y `?format=md` lo
  fuerzan). Las hojas HTML anuncian su gemelo con una cabecera `Link`.
- `/commons/files/<fichero>` sale de R2 (`commons/<fichero>`) y
  `/download/files/<ruta>` también (`reader/<ruta>`), con rangos HTTP (206),
  `ETag` y CORS, para que un lector pueda abrir un `.spdf` remoto sin bajarlo entero.
- Cabeceras de seguridad comunes, sin pisar las que ya trae el fichero (el lector
  lleva COOP y COEP para SQLite con OPFS y los hilos de WebAssembly).

## Ficheros en R2

```sh
export CLOUDFLARE_ACCOUNT_ID=f22c7a728ddc8e41cefd2644f8fb7632
npx wrangler r2 object put spdf-web/commons/<fichero>.spdf --file <ruta> --content-type application/vnd.spdf --remote
npx wrangler r2 object put spdf-web/reader/<versión>/<fichero> --file <ruta> --remote
```

`npx tsx commons/publicar.ts [catálogo] [carpeta]` comprueba cada obra (SHA-256,
validez, verificación), la sube a R2 y copia el catálogo a `commons/catalogo.json`.
`npx tsx scripts/subir-lector.ts reader-v<versión>` baja con `gh` los binarios
de una release del lector, los sube a R2 (`reader/<versión>/`) y reescribe
`descargas.json`.

## Imágenes fijas

`npx tsx generador/tarjetas.ts` rehace las tarjetas para redes
(`public/tarjeta-en.png`, `public/tarjeta-es.png`), el icono de Apple y el
favicon. `cd muestras && npm run generar` rehace las muestras del validador.

## Comprobaciones hechas (7 de octubre de 2026)

- `curl` a `/`, `/es`, `/spec`, `/validator`, `/llms.txt`, `/robots.txt`,
  `/sitemap.xml`, `/spec.md`, `/status.json`, `/reader/`, una muestra `.spdf`,
  `/zotero/spdf-zotero.xpi`, `/zotero/updates.json`, `/schema/5.0/*.schema.json`
  y las doce obras de Commons (200 completas y 206 con `Range`): todo responde.
  Una ruta inexistente da 404 con su hoja. `curl` a la raíz devuelve el
  Markdown de la portada.
- Lighthouse 13, móvil: 100 · 100 · 100 · 100 en `/`, `/es`, `/spec`,
  `/implementations`, `/validator`, `/es/citar`, `/es/commons` y `/docs/rust`;
  escritorio: 100 en las cuatro en `/` y `/validator`. Portada en móvil:
  LCP 1,2 s, TBT 0 ms, CLS 0.
- Capturas con Chrome headless por CDP, en escritorio (1440 px) y en móvil
  (390 px, iPhone emulado), de la portada en las dos lenguas, la especificación,
  las implementaciones, la documentación, Commons, el 404 y el validador con una
  muestra y con una obra de Commons cargadas, probado pestaña a pestaña sin
  errores en la consola.
- SPDF Commons: las doce obras validan con Rust (`spdf-tools`), JS y Python sin
  errores ni avisos, y cada una dice en su ficha cómo se verificaron a ojo sus
  folios o sus tiempos.

## Pendiente

- Desplegar desde el CI: hace falta un token de API de Cloudflare con permiso
  de Workers en los secretos del repositorio (`CLOUDFLARE_API_TOKEN`). Mientras
  tanto, el workflow `site` construye y prueba, y el despliegue se hace en local.
- Los binarios del lector (releases `reader-v…`): cuando existan,
  `npx tsx scripts/subir-lector.ts reader-v<versión>` y desplegar.
- El dataset de Hugging Face de SPDF Commons no se ha preparado: no hay token en
  `~/.cache/huggingface/token`.
