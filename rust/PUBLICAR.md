# Publicar los crates en crates.io

Nada está publicado todavía: no hay credenciales en este entorno. Estos son los pasos
para cuando José Luis quiera hacerlo.

## Nombres (comprobados el 7 de octubre de 2026)

| crate | estado en crates.io | qué es |
|---|---|---|
| `spdf` | libre | la biblioteca |
| `spdf-tools` | libre | la CLI; instala el binario `spdf` |
| `spdf-ffi` | libre | la ABI de C (`cdylib` + `staticlib` + `rlib`) |

`spdf-cli` **no** está libre: lo usa otro proyecto (un analizador de PDF que publica
`spdf-core`, `spdf-types`, etc.). Por eso la CLI se llama `spdf-tools`. Conviene
publicar `spdf` pronto para no perder el nombre: ese proyecto ya tiene varios crates con
el prefijo.

## Antes de publicar

1. Cuenta en crates.io con el correo verificado y un token con permiso
   `publish-new` (y luego `publish-update`): <https://crates.io/settings/tokens>.
   `cargo login` y pegar el token. Nunca se guarda en el repositorio.
2. Que el CI de `rust` esté en verde en main (pruebas en Linux, macOS y Windows,
   conformidad completa, clippy, formato, cabecera C al día, MSRV 1.85).
3. Subir la versión en `rust/Cargo.toml` (`[workspace.package] version` y la versión de
   `spdf` en `[workspace.dependencies]`) si no es la primera publicación.
4. Comprobar el paquete sin subirlo:

   ```sh
   cd rust
   cargo publish --dry-run -p spdf
   ```

   (`spdf-tools` y `spdf-ffi` solo pasan el `--dry-run` después de publicar `spdf`,
   porque dependen de él por versión.)

## Publicación, en este orden

```sh
cd rust
cargo publish -p spdf
# esperar a que aparezca en el índice (un minuto)
cargo publish -p spdf-tools
cargo publish -p spdf-ffi
```

Después:

- etiqueta en git: `git tag rust-v0.1.0 && git push origin rust-v0.1.0`;
- comprobar la documentación generada en <https://docs.rs/spdf> (se construye con
  todas las features: `[package.metadata.docs.rs] all-features = true`);
- `cargo install spdf-tools` en una máquina limpia y `spdf --version`.

## Qué incluye cada paquete

- `spdf`: `src/`, `README.md`, las dos licencias. Las pruebas y el arnés de rendimiento
  se quedan fuera (necesitan la batería de `conformance/`, que vive en el repositorio).
- `spdf-tools`: `src/`, `README.md`, licencias.
- `spdf-ffi`: `src/`, `include/spdf.h`, `cbindgen.toml`, `README.md`, licencias.

Licencia doble MIT OR Apache-2.0 en los tres (`LICENSE-MIT`, `LICENSE-APACHE` copiadas
en cada crate). La especificación es CC BY 4.0 y no va en los paquetes.

## Binarios precompilados (opcional)

Para la implementación en C y para quien no use Cargo: un workflow de publicación que, al
empujar una etiqueta `rust-v*`, compile `spdf` (CLI) y `libspdf_ffi` para
`x86_64/aarch64-unknown-linux-gnu`, `x86_64/aarch64-apple-darwin` y
`x86_64-pc-windows-msvc` y los adjunte a la release de GitHub junto con `spdf.h`. No está
hecho; cuando el repositorio sea público es un paso pequeño.
