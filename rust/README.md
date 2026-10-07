# SPDF en Rust: la implementación de referencia

Espacio de trabajo Cargo con tres crates:

| crate | qué es |
|---|---|
| [`crates/spdf`](crates/spdf) | la biblioteca: apertura segura, lectura 5.0 y legado 4.x, validación, volcado canónico, búsqueda léxica, vectorial e híbrida, anclas y URI, cita corta, CSL-JSON y BibTeX, escritor, conversión del legado, integridad y firma, lectura remota por rangos HTTP (`--features http`, experimental) |
| [`crates/spdf-tools`](crates/spdf-tools) | la CLI `spdf` |
| [`crates/spdf-ffi`](crates/spdf-ffi) | la ABI de C estable (`include/spdf.h`) |

SQLite va empaquetado (`rusqlite` con `bundled`): la misma versión y el mismo FTS5 en
macOS, Linux, Windows, iOS y Android.

## Uso rápido

```sh
cd rust
cargo build --release
./target/release/spdf validate ../conformance/files/quijote.spdf
./target/release/spdf search ../conformance/files/quijote.spdf --lexical hidalgo
./target/release/spdf conformance ../conformance > conformance.json
```

Desde otro crate del repositorio (por ejemplo el lector Tauri):

```toml
spdf = { path = "../../rust/crates/spdf" }
```

## Pruebas

```sh
cargo test --workspace --all-features   # unitarias, de propiedades, de API, remotas, conformidad y doctests
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo fmt --all -- --check
cargo bench -p spdf --features http     # véase RENDIMIENTO.md
```

La prueba `tests/conformance.rs` ejecuta toda la batería de `../conformance/cases`; el CI
(`.github/workflows/rust.yml`) la corre en Linux, macOS y Windows y sube el informe como
artefacto `conformance-rust`.

## Documentos

- [`NOTAS.md`](NOTAS.md): decisiones propias y observaciones para el agente de la
  especificación.
- [`RENDIMIENTO.md`](RENDIMIENTO.md): cifras.
- [`PUBLICAR.md`](PUBLICAR.md): cómo publicar en crates.io.

Licencia: MIT OR Apache-2.0.
