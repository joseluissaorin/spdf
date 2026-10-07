# Publicar la gema en RubyGems

Gema: `spdf-format` (se carga con `require "spdf"`). Nada de esto se ha hecho todavía.

## Antes

1. Cuenta en https://rubygems.org con autenticación en dos pasos (la gemspec exige MFA
   con `rubygems_mfa_required`).
2. Comprobar en limpio desde `ruby/`:
   ```sh
   ruby -Ilib -Itest test/test_document.rb
   ruby -Ilib exe/spdf conformance ../conformance
   gem build spdf-format.gemspec
   ```
3. Revisar la versión en `lib/spdf/version.rb` y el CHANGELOG.

## Publicar

```sh
gem push spdf-format-0.1.0.gem
```

La gema contiene solo `lib/`, `exe/`, el README y las dos licencias; no lleva ficheros de
conformidad.

## Después

- Etiqueta `ruby-v0.1.0` en el monorepo para saber de qué commit salió.
- Opcional: publicación de confianza (*trusted publishing*) de RubyGems desde GitHub
  Actions, para no guardar claves: se configura en la página de la gema y se usa
  `rubygems/release-gem` en un workflow aparte.
