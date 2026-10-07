# Publicar el paquete en CRAN

Paquete: `spdf`. Nada de esto se ha hecho todavía.

## Antes

1. El repositorio debe ser **público**: `R CMD check --as-cran` da hoy una NOTE porque
   las URL de GitHub de `DESCRIPTION` devuelven 404 mientras es privado. Es la única
   NOTE además de «New submission».
2. Comprobar en limpio (sin el PATH de conda, que rompe la compilación de `xml2`):
   ```sh
   cd r
   Rscript -e 'roxygen2::roxygenise()'
   cd .. && R CMD build r && R CMD check --as-cran spdf_0.1.0.tar.gz
   ```
   y en win-builder (`devtools::check_win_devel()`) y R-hub (`rhub::rhub_check()`).
3. Revisar `cran-comments.md` (crearlo con el resultado de las comprobaciones).
4. El nombre `spdf` está libre en CRAN a 7-10-2026; comprobarlo de nuevo antes de enviar.

## Enviar

- `devtools::release()` o el formulario https://cran.r-project.org/submit.html con el
  `.tar.gz`. CRAN envía un correo de confirmación al mantenedor
  (jl@joseluissaorin.com) que hay que aceptar.
- Política de CRAN a tener en cuenta: los ejemplos y la viñeta no escriben fuera de
  `tempdir()` (ya es así) y no usan internet.

## Después

- Etiqueta `r-v0.1.0` en el monorepo.
- Las versiones nuevas suben `Version:` en `DESCRIPTION` y añaden una entrada a `NEWS.md`.
