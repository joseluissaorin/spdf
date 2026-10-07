# Publicar SPDF.jl en el registro General de Julia

Paquete: `SPDF` (`SPDF.jl`), UUID `235ecbd5-73c5-4219-98a8-d69459b681a1`. Nada de esto se
ha hecho todavía.

## Antes

1. El repositorio debe ser **público**.
2. El registro General está pensado para paquetes en la raíz de un repositorio; los
   subdirectorios se admiten (`subdir`), pero lo más limpio es un espejo
   `joseluissaorin/SPDF.jl` alimentado con `git subtree split --prefix julia`.
3. El nombre `SPDF` tiene 4 letras y va en mayúsculas: la fusión automática del registro
   (AutoMerge) exige al menos 5 caracteres, así que la primera versión necesitará
   revisión manual. Argumento para los revisores: es la sigla de un formato abierto con
   especificación pública (como `JSON`, `CSV` o `HDF5`). Alternativa si lo rechazan:
   `SPDFFormat`.
4. Comprobar en limpio: `julia --project=. -e 'using Pkg; Pkg.test()'`.

## Publicar

1. Instalar la aplicación Registrator de GitHub en el repositorio (o en el espejo).
2. Comentar `@JuliaRegistrator register` en el commit que se quiere publicar
   (con `subdir=julia` si se publica desde el monorepo).
3. Instalar también TagBot para que cree la etiqueta y la release al fusionarse.

## Después

- Cada versión nueva sube `version` en `Project.toml` y se registra igual.
- Mantener las cotas de `[compat]` al día (CompatHelper lo automatiza).
