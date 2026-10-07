# Publicar spdf-format en PyPI

El paquete se publica en PyPI como **`spdf-format`** (se importa `spdf`; el nombre `spdf` ya
lo usa otro proyecto). La publicación la hace GitHub Actions con *Trusted Publishing*: no
hay tokens ni contraseñas en el repositorio ni en los secretos de GitHub. El mismo sistema
publica ya `scholaris-sdk`.

Todavía no se ha publicado nada. Para la primera versión hacen falta dos pasos manuales
(1 y 2) que solo puede dar José Luis con su cuenta; después, cada versión es una etiqueta.

## 1. Registrar el publicador pendiente en PyPI

Como el proyecto aún no existe en PyPI, se registra como *pending publisher*:

1. Entrar en PyPI con la cuenta de José Luis y abrir
   <https://pypi.org/manage/account/publishing/>.
2. En «Add a new pending publisher», elegir **GitHub** y rellenar exactamente:

   | Campo | Valor |
   |---|---|
   | PyPI Project Name | `spdf-format` |
   | Owner | `joseluissaorin` |
   | Repository name | `spdf` |
   | Workflow name | `python.yml` |
   | Environment name | `pypi` |

3. Guardar. La primera publicación crea el proyecto y convierte el publicador pendiente
   en definitivo.

Si el repositorio se transfiere a la organización `spdf-format` (como prevé
`DECISIONES.md`), hay que cambiar el *Owner* del publicador en la página del proyecto
(<https://pypi.org/manage/project/spdf-format/settings/publishing/>) antes de publicar la
siguiente versión.

## 2. Crear el entorno `pypi` en GitHub

En <https://github.com/joseluissaorin/spdf/settings/environments>, «New environment» con el
nombre **`pypi`**. Conviene protegerlo:

- *Required reviewers*: José Luis (así ninguna publicación sale sin su visto bueno).
- *Deployment branches and tags*: solo las etiquetas que cumplan `python-v*`.

## 3. Publicar una versión

1. Subir la versión en un único sitio: `python/src/spdf/_version.py`
   (`__version__ = "0.1.0"`); `pyproject.toml` la lee de ahí.
2. Comprobar en local, desde `python/`:

   ```sh
   uv sync --group dev
   uv run pytest
   uv run ruff check src tests && uv run ruff format --check src tests
   uv run mypy
   uv run spdf conformance ../conformance
   uv build && uvx twine check --strict dist/*
   ```

3. Confirmar el cambio en `main` y crear la etiqueta, que debe coincidir con la versión:

   ```sh
   git tag python-v0.1.0
   git push origin python-v0.1.0
   ```

4. El workflow `.github/workflows/python.yml` pasa ruff, mypy, las pruebas en Linux, macOS
   y Windows con Python 3.10 a 3.13, la batería de conformidad y el build (comprueba que la
   etiqueta coincide con `_version.py` y que la rueda instalada pasa la conformidad). Si
   todo está en verde, el trabajo `publish` espera la aprobación del entorno `pypi` y sube
   la rueda y el sdist con `pypa/gh-action-pypi-publish`.

5. Comprobar <https://pypi.org/project/spdf-format/> y una instalación limpia:

   ```sh
   uvx --from spdf-format spdf --version
   ```

## Notas

- Una versión publicada en PyPI no se puede volver a subir con el mismo número: si algo
  sale mal, se corrige y se publica la siguiente versión de parche.
- La acción de publicación genera atestaciones de procedencia (PEP 740). Si el repositorio
  sigue siendo privado y ese paso fallara, se puede publicar con `attestations: false` en
  el paso `pypa/gh-action-pypi-publish` o esperar a que el repositorio sea público.
- Para un ensayo en TestPyPI haría falta un segundo publicador pendiente en
  <https://test.pypi.org/manage/account/publishing/> (mismo owner, repo y workflow, entorno
  `testpypi`) y un trabajo gemelo con `repository-url: https://test.pypi.org/legacy/`; no
  está montado para no duplicar el flujo.
