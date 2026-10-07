# Publicar la biblioteca PHP en Packagist

Paquete: `joseluissaorin/spdf` (Composer). Nada de esto se ha hecho todavía.

## Antes de la primera publicación

1. El repositorio tiene que ser **público**: Packagist lee el código de GitHub.
2. Packagist espera `composer.json` en la raíz del repositorio y aquí está en `php/`.
   Hay dos caminos:
   - **Repositorio espejo** (recomendado): `joseluissaorin/spdf-php`, alimentado con
     `git subtree split --prefix php -b php-dist` y un `git push` de esa rama, a mano o
     con una acción (por ejemplo `symplify/monorepo-split-github-action`).
   - Publicar el monorepo con `"type": "library"` y una entrada `path` es posible, pero
     Packagist no lo admite bien para subcarpetas; mejor el espejo.
3. Comprobar en limpio:
   ```sh
   cd php && composer validate --strict && composer install && vendor/bin/phpunit
   php bin/spdf conformance ../conformance
   ```

## Publicar

1. Entrar en https://packagist.org con la cuenta de GitHub de José Luis.
2. *Submit* → URL del repositorio espejo → *Check* → *Submit*.
3. En GitHub, *Settings → Webhooks* del espejo: Packagist ofrece su webhook (o la
   integración «Packagist» de GitHub) para que cada etiqueta se publique sola.
4. Versión: etiqueta `v0.1.0` en el espejo (Composer lee las etiquetas; no hay campo
   `version` en `composer.json`, y así debe seguir).

## Después

- Cada versión nueva: etiqueta `vX.Y.Z` en el espejo, con el CHANGELOG al día.
- La versión que imprime el runner de conformidad está en
  `src/Conformance/Runner.php` (`VERSION`); hay que subirla a la vez.
- Los ejemplos de OJS y Omeka S no se publican como paquetes propios: son bocetos.
