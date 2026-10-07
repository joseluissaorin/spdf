# Publicar spdf-format en npm

El paquete se publica en npm como **`spdf-format`** (el nombre `spdf` ya lo usa otro
proyecto). La publicación la hace GitHub Actions con *trusted publishing* de npm (OIDC):
no hay tokens de npm en el repositorio ni en los secretos de GitHub, y cada versión sale
con su atestación de procedencia (*provenance*) firmada.

Todavía no se ha publicado nada. Los pasos 1 y 2 solo puede darlos José Luis con su
cuenta; después, cada versión es una etiqueta `js-v<versión>`.

## 1. Comprobar el nombre y configurar el publicador de confianza

1. Comprobar que el nombre sigue libre: `npm view spdf-format` debe responder `404`.
2. Entrar en <https://www.npmjs.com> con la cuenta de José Luis (con la verificación en dos
   pasos activada).
3. Si npm ya permite registrar un publicador de confianza para un paquete que aún no
   existe, hacerlo desde la configuración de la cuenta. Si no lo permite (era lo habitual
   en 2025), la primera versión se publica a mano una sola vez, desde `js/` y con la
   versión ya comprobada (paso 3), con `npm login` y después
   `npm publish --access public`; npm pedirá el código de la verificación en dos pasos.
4. En la página del paquete, *Settings* → *Trusted publishing* → *GitHub Actions*,
   rellenar exactamente:

   | Campo | Valor |
   |---|---|
   | Organization or user | `joseluissaorin` |
   | Repository | `spdf` |
   | Workflow filename | `js.yml` |
   | Environment name | `npm` |

5. En la misma página, en *Publishing access*, elegir «Require two-factor authentication
   and disallow tokens». Así solo el flujo de GitHub puede publicar.

Si el repositorio se transfiere a la organización `spdf-format` (como prevé
`DECISIONES.md`), hay que cambiar el propietario del publicador de confianza antes de la
siguiente versión.

## 2. Crear el entorno `npm` en GitHub

En <https://github.com/joseluissaorin/spdf/settings/environments>, «New environment» con el
nombre **`npm`**, protegido así:

- *Required reviewers*: José Luis (ninguna publicación sale sin su visto bueno).
- *Deployment branches and tags*: solo las etiquetas que cumplan `js-v*`.

## 3. Preparar una versión

1. Cambiar la versión en dos sitios que deben coincidir: `js/package.json` (`version`) y
   `js/src/version.ts` (`VERSION`). Una prueba falla si no coinciden.
2. Comprobar en local, desde `js/`:

   ```sh
   npm ci
   npm run typecheck
   npm run build
   npm test                      # unitarias + batería completa con node:sqlite y sqlite-wasm
   npm run test:bun              # batería completa con bun:sqlite
   npm run test:browser          # batería en Chromium, lectura remota, OPFS
   node dist/cli/main.js conformance ../conformance
   npm pack --dry-run            # revisar la lista de ficheros (dist, README, licencias)
   ```

3. Confirmar el cambio en `main`, esperar a que el flujo `js` esté en verde y crear la
   etiqueta, que debe coincidir con la versión de `package.json`:

   ```sh
   git tag js-v0.1.0
   git push origin js-v0.1.0
   ```

## 4. Lo que hace GitHub Actions

La etiqueta `js-v*` lanza el trabajo `publish` de `.github/workflows/js.yml`, que:

1. comprueba que la etiqueta coincide con `package.json`;
2. instala, compila y pasa las pruebas y la batería de conformidad;
3. espera la aprobación del entorno `npm`;
4. ejecuta `npm publish --access public` con permiso `id-token: write`; npm canjea el
   token OIDC de GitHub por una credencial de un solo uso y añade la procedencia.

Después, la versión aparece en <https://www.npmjs.com/package/spdf-format> con la marca de
procedencia que enlaza con el commit y la ejecución exactos.

## 5. Después de publicar

- Scholaris usa hoy un tarball versionado dentro de su repositorio
  (`vendor/spdf-format-<versión>.tgz`). Para pasar a la dependencia publicada, en
  `apps/api/package.json` (y en `apps/web/package.json` si la usa) cambiar
  `"spdf-format": "file:../../vendor/spdf-format-0.1.0.tgz"` por `"spdf-format": "^0.1.0"`,
  ejecutar `pnpm install`, comprobar que `pnpm -r typecheck`, `pnpm -r test` y el build
  pasan, y borrar el tarball de `vendor/`.
- Los agentes *reader* y *site* enlazan el paquete por ruta (`file:../js`); pueden seguir
  así dentro del monorepo o pasar a la versión publicada.
- Una versión publicada no se puede reutilizar: si sale mal, se publica la siguiente y se
  marca la mala con `npm deprecate spdf-format@<versión> "<motivo>"`.
