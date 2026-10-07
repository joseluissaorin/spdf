# Publicar Spdf.Format en NuGet.org

El paquete es `Spdf.Format` (espacio de nombres `Spdf`) y vive en la carpeta `dotnet/` del
monorepo. Solo se publica la biblioteca (`src/Spdf.Format`); la CLI y las pruebas no se
empaquetan. Nada de esto se hace automáticamente: publicar es una decisión explícita.

## Requisitos previos

- La CI de `dotnet` en verde (`.github/workflows/dotnet.yml`: compilación, pruebas y la
  batería de conformidad completa en Linux, macOS y Windows, más `dotnet pack`).
- El repositorio `github.com/joseluissaorin/spdf` debería ser **público** antes de la primera
  versión: el paquete lleva SourceLink, y los enlaces al código fuente solo sirven a quien
  pueda leer el repositorio.
- SDK de .NET 8 o posterior en la máquina que empaqueta.

## 1. Cuenta en NuGet.org

1. Entrar en <https://www.nuget.org> con una cuenta Microsoft (la personal de José Luis o
   una creada para el proyecto) y activar la verificación en dos pasos, que NuGet.org exige
   para publicar.
2. Opcional pero recomendable: crear una **organización** (por ejemplo, `spdf-format`) y
   publicar desde ella, para poder añadir más propietarios sin compartir credenciales.

## 2. Reservar el prefijo del identificador

La reserva de prefijo hace que solo los propietarios autorizados puedan publicar paquetes
cuyo identificador empiece por `Spdf.` y que NuGet.org les muestre la marca de verificación.

1. Publicar antes al menos una versión de `Spdf.Format` (la reserva se pide para
   identificadores que ya existen o están a punto de existir).
2. Escribir a <account@nuget.org> desde la cuenta propietaria pidiendo la reserva del
   prefijo `Spdf.*`, con el enlace al repositorio y a la web
   (<https://spdf.joseluissaorin.com>). El equipo de NuGet la revisa a mano según sus
   criterios (prefijo distintivo, propietario identificable, proyecto real).

## 3. Credenciales de publicación

Hay dos caminos; el segundo evita guardar claves.

### Opción A: clave de API

1. En NuGet.org, menú de la cuenta, **API Keys**, **Create**.
2. Alcance **Push** (solo «Push new packages and package versions»), patrón de paquetes
   `Spdf.Format` (o `Spdf.*` cuando el prefijo esté reservado) y caducidad corta (por
   ejemplo, 90 días).
3. Copiar la clave en el momento y guardarla **fuera del repositorio**: en el llavero del
   sistema para publicar a mano, o como secreto del repositorio en GitHub
   (`Settings`, `Secrets and variables`, `Actions`, nombre `NUGET_API_KEY`) para publicar
   desde la CI. Nunca en un fichero, en un `nuget.config` ni en el historial de la shell.

### Opción B: publicación de confianza desde GitHub Actions (recomendada)

NuGet.org admite *trusted publishing*: el flujo de trabajo de GitHub obtiene una clave
temporal mediante OIDC y no hay ningún secreto que custodiar.

1. En NuGet.org, menú de la cuenta, **Trusted Publishing**, añadir una política para el
   repositorio `joseluissaorin/spdf`, el fichero de flujo de trabajo que publicará (por
   ejemplo, `.github/workflows/dotnet-publish.yml`) y, si se quiere, un entorno de GitHub
   protegido (por ejemplo, `nuget`) que exija aprobación manual.
2. En el flujo de trabajo, dar el permiso `id-token: write`, iniciar sesión con la acción
   `NuGet/login@v1` (parámetro `user`: el nombre de la cuenta u organización de NuGet.org)
   y usar la clave que devuelve en `dotnet nuget push`. La clave dura una hora.

## 4. Preparar la versión

1. Cambiar la versión en **dos** sitios, que deben coincidir:
   - `dotnet/Directory.Build.props`, elemento `<Version>`;
   - `dotnet/src/Spdf.Format/SpdfInfo.cs`, constante `Version` (la que aparece en los
     informes de conformidad y en `spdf_meta.generator`).
2. Comprobar que la batería pasa entera con la versión nueva:

   ```sh
   cd dotnet
   dotnet test -c Release
   dotnet run --project src/Spdf.Cli -c Release -- conformance ../conformance
   ```

3. Confirmar los cambios en `main` y crear una etiqueta con el prefijo de la carpeta:

   ```sh
   git tag dotnet/v0.1.0
   git push origin dotnet/v0.1.0
   ```

## 5. Empaquetar

```sh
cd dotnet
dotnet pack src/Spdf.Format -c Release -o artifacts
```

Salen dos ficheros: `artifacts/Spdf.Format.0.1.0.nupkg` (el paquete, con el README, la
licencia `MIT OR Apache-2.0`, la documentación XML y SourceLink) y
`artifacts/Spdf.Format.0.1.0.snupkg` (los símbolos de depuración). Antes de subirlos,
revisar el contenido con `unzip -l artifacts/Spdf.Format.0.1.0.nupkg` o con NuGet Package
Explorer: debe haber `lib/net8.0/Spdf.Format.dll`, `lib/net8.0/Spdf.Format.xml` y
`README.md`, y ninguna ruta local de la máquina.

Para que la compilación sea determinista fuera de la CI, se puede añadir
`-p:ContinuousIntegrationBuild=true` (la CI de GitHub ya lo activa sola).

## 6. Subir

Con una clave de API guardada en una variable de entorno de la sesión (sin escribirla en la
orden):

```sh
dotnet nuget push artifacts/Spdf.Format.0.1.0.nupkg \
  --api-key "$NUGET_API_KEY" \
  --source https://api.nuget.org/v3/index.json
```

`dotnet nuget push` sube también el `.snupkg` que encuentre junto al `.nupkg`. NuGet.org
valida el paquete e indexa la versión en unos minutos; hasta entonces no aparece en las
búsquedas ni se puede instalar.

## 7. Firma del paquete (opcional)

NuGet.org añade siempre su firma de repositorio. La firma de autor es opcional y requiere un
certificado de firma de código emitido por una autoridad reconocida, registrado antes en la
cuenta de NuGet.org:

```sh
dotnet nuget sign artifacts/Spdf.Format.0.1.0.nupkg \
  --certificate-path ruta/al/certificado.pfx \
  --timestamper http://timestamp.digicert.com
```

La contraseña del certificado se pide de forma interactiva o se toma del llavero; nunca va
en el repositorio. El certificado de la FNMT de José Luis no sirve para esto: es de firma
de documentos, no de firma de código.

## Después de publicar

- Comprobar la página `https://www.nuget.org/packages/Spdf.Format`, que el README se vea
  bien y que `dotnet add package Spdf.Format` funcione en un proyecto vacío.
- Una versión publicada **no se puede borrar**: si sale mal, se publica otra y la mala se
  oculta del listado (*unlist*) o se marca como obsoleta (*deprecate*) desde NuGet.org.
- Revocar en NuGet.org cualquier clave de API que ya no se use.
