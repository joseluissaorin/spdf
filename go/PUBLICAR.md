# Publicar el módulo de Go

El módulo es `github.com/joseluissaorin/spdf/go` y vive en la carpeta `go/` del
monorepo. Go no tiene un registro central: pkg.go.dev y el proxy de módulos
(`proxy.golang.org`) leen directamente el repositorio de GitHub.

## Requisitos

- El repositorio `github.com/joseluissaorin/spdf` tiene que ser **público** (el proxy no
  puede leer repositorios privados).
- La CI de `go` en verde (`.github/workflows/go.yml`: vet, pruebas, compilación cruzada
  y la batería de conformidad completa).
- Si el repositorio se transfiere a la organización `spdf-format`, la ruta del módulo
  cambia: hay que editar la línea `module` de `go/go.mod`, las importaciones internas
  (`go/conformance`, `go/cmd/spdf`) y el README antes de etiquetar.

## Pasos

1. Actualizar `Version` en `go/spdf.go` (por ejemplo, `0.1.0`).
2. Confirmar y subir a `main`.
3. Crear la etiqueta **con el prefijo de la carpeta** (obligatorio en un monorepo):

   ```sh
   git tag go/v0.1.0
   git push origin go/v0.1.0
   ```

4. Pedir al proxy que indexe la versión (pkg.go.dev lo recoge en unos minutos):

   ```sh
   GOPROXY=https://proxy.golang.org GO111MODULE=on go list -m github.com/joseluissaorin/spdf/go@v0.1.0
   ```

5. Comprobar en `https://pkg.go.dev/github.com/joseluissaorin/spdf/go` que aparecen la
   documentación y la licencia (pkg.go.dev necesita detectar una licencia reconocida;
   las dos de la raíz, MIT y Apache-2.0, sirven porque el módulo está dentro del
   repositorio que las contiene).

## Notas

- Una versión publicada en el proxy **no se puede borrar**; si sale mal, se publica otra
  y se retira la mala con una directiva `retract` en `go.mod`.
- Las versiones `v2` o superiores exigen cambiar la ruta del módulo a `…/go/v2`.
- `go install github.com/joseluissaorin/spdf/go/cmd/spdf@latest` instala la CLI.
