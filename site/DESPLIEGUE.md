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
3. `site/`: `npm ci`, `npm run build` (la web entera en `site/dist`) y `npm test`.
4. `npx wrangler deploy` (siempre `npx`, nunca `wrangler` a secas).
5. Comprueba con `curl` que responden `/`, `/es`, `/spec`, `/validator`,
   `/llms.txt`, `/sitemap.xml` y `/reader/`, y que `curl` a la raíz devuelve Markdown.

Sin red (o sin `gh`), `SPDF_SIN_RED=1 site/scripts/desplegar.sh`: el estado del
CI sale de la última copia (`site/.cache/estado.json`) o como «sin datos».

Hay que desplegar desde un checkout al día de `main` (en este proyecto, el
worktree `~/Developer/spdf-worktrees/site`, rama `agente-site`, después de
`git pull --rebase --autostash origin main`): la web lee la especificación, los
README de cada implementación y de cada integración, la gobernanza y las RFC
del propio repositorio al construir.

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
| Lector web (`/reader/`) | `reader/dist-web` |
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

`commons/publicar.ts` sube la colección entera y reescribe `commons/catalogo.json`.

## Imágenes fijas

`npx tsx generador/tarjetas.ts` rehace las tarjetas para redes
(`public/tarjeta-en.png`, `public/tarjeta-es.png`), el icono de Apple y el
favicon. `cd muestras && npm run generar` rehace las muestras del validador.

## Comprobaciones hechas (7 de octubre de 2026)

- `curl` a `/`, `/es`, `/spec`, `/validator`, `/llms.txt`, `/robots.txt`,
  `/sitemap.xml`, `/spec.md`, `/status.json`, `/reader/` y una muestra `.spdf`:
  200; una ruta inexistente: 404 con su hoja. `curl` a la raíz devuelve el
  Markdown de la portada.
- Lighthouse 13 (móvil): 100 · 100 · 100 · 100 en `/`, `/spec`, `/validator`,
  `/es/citar` y `/docs/rust`; escritorio: 100 en las cuatro en `/` y
  `/validator`. Portada en móvil: LCP 1,3 s, TBT 0 ms, CLS 0.
- Capturas con Chrome headless por CDP, en escritorio (1440 px) y en móvil
  (390 px, iPhone emulado), de la portada en las dos lenguas, la especificación,
  la documentación y el validador con una muestra cargada; el validador,
  probado pestaña a pestaña sin errores en la consola.

## Pendiente

- Desplegar desde el CI: hace falta un token de API de Cloudflare con permiso
  de Workers en los secretos del repositorio (`CLOUDFLARE_API_TOKEN`). Mientras
  tanto, el workflow `site` construye y prueba, y el despliegue se hace en local.
- Cuando el repositorio sea público, construir con `SPDF_REPO_PUBLICO=1` para
  que la web enlace a GitHub (README, código, RFC).
