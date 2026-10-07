# Publicar la biblioteca de Kotlin en Maven Central

La implementación de Kotlin se publica como tres artefactos con la misma versión:

| Artefacto | Contenido |
|---|---|
| `io.github.joseluissaorin:spdf-core` | toda la lógica, sin SQLite |
| `io.github.joseluissaorin:spdf` | el núcleo más el adaptador de `sqlite-jdbc` y la herramienta de línea de órdenes (el artefacto que usará casi todo el mundo en la JVM) |
| `io.github.joseluissaorin:spdf-android` | el núcleo más el adaptador de `androidx.sqlite` con el SQLite incluido |

Los tres se publican juntos desde la carpeta `kotlin/` con el complemento
`com.vanniktech.maven.publish`, que ya está configurado en `build.gradle.kts`. El complemento
genera el jar de fuentes y el de documentación, escribe el POM con nombre, descripción,
licencias (MIT y Apache-2.0), desarrollador y repositorio, firma con GPG y sube el
resultado al Central Portal de Sonatype. No hace falta Google Maven para publicar: solo se
usa para descargar `androidx.sqlite` al compilar.

## Preparación (una sola vez)

1. **Cuenta en el Central Portal.** Entrar en <https://central.sonatype.com> con la cuenta de
   GitHub `joseluissaorin`. Al hacerlo con GitHub, el espacio de nombres
   `io.github.joseluissaorin` queda verificado de forma automática; puede comprobarse en
   *Namespaces*. Si se entra de otra manera, hay que añadir el espacio de nombres a mano y
   verificarlo creando en GitHub un repositorio público temporal con el nombre de la clave
   que indica el portal; tras la verificación se puede borrar.
2. **Token de publicación.** En el portal, *View Account* y luego *Generate User Token*. El
   usuario y la contraseña que devuelve van en `~/.gradle/gradle.properties` (fuera del
   repositorio, nunca en él):

   ```properties
   mavenCentralUsername=<usuario del token>
   mavenCentralPassword=<contraseña del token>
   ```

3. **Clave GPG para firmar.** Maven Central rechaza artefactos sin firma.

   ```sh
   gpg --full-generate-key                       # RSA de 4096 bits o ed25519, con contraseña
   gpg --list-secret-keys --keyid-format short   # el identificador corto son 8 caracteres
   gpg --keyserver keyserver.ubuntu.com --send-keys <ID>
   gpg --keyserver keys.openpgp.org --send-keys <ID>
   gpg --export-secret-keys --armor <ID> > /tmp/clave.asc
   ```

   El contenido de `/tmp/clave.asc` se copia en `~/.gradle/gradle.properties` como una sola
   línea, cambiando los saltos de línea por `\n`, y después se borra el fichero:

   ```properties
   signingInMemoryKey=-----BEGIN PGP PRIVATE KEY BLOCK-----\n…\n-----END PGP PRIVATE KEY BLOCK-----
   signingInMemoryKeyId=<ID de 8 caracteres>
   signingInMemoryKeyPassword=<contraseña de la clave>
   ```

   La compilación solo firma cuando encuentra `signingInMemoryKey` (o `signing.keyId`), así
   que las compilaciones locales y la CI funcionan sin clave. La contraseña puede guardarse
   en el llavero de macOS y exportarse como variable `ORG_GRADLE_PROJECT_signingInMemoryKeyPassword`
   justo antes de publicar, en lugar de dejarla escrita en el fichero.

## Comprobaciones antes de cada versión

1. La CI de `kotlin` en verde en macOS, Linux y Windows (`.github/workflows/kotlin.yml`).
2. En local, desde `kotlin/`:

   ```sh
   ./gradlew build                 # pruebas; los dos adaptadores pasan la batería entera
   ./gradlew :spdf:conformance     # informe en build/conformance.json, sin fallos
   ./gradlew publishAllPublicationsToBuildRepoRepository
   ```

   La última orden deja en `build/repo` exactamente lo que se subiría. Para cada artefacto
   tiene que haber `.jar`, `-sources.jar`, `-javadoc.jar`, `.pom` y `.module`, y además los
   ficheros `.asc` de firma si la clave está configurada. Conviene revisar que el POM de
   `spdf` declara `spdf-core` y `sqlite-jdbc`, y el de `spdf-android` declara `spdf-core` y
   `androidx.sqlite`.

## Publicar una versión

1. Cambiar la versión en dos sitios, que deben coincidir: `VERSION_NAME` en
   `kotlin/gradle.properties` y `VERSION` en
   `spdf-core/src/main/kotlin/io/github/joseluissaorin/spdf/Spdf.kt` (es la que aparece en el
   informe de conformidad y en `spdf version`).
2. Confirmar el cambio, subirlo a `main` y crear la etiqueta con el prefijo de la carpeta:

   ```sh
   git tag kotlin/v0.1.0
   git push origin kotlin/v0.1.0
   ```

3. Subir los artefactos desde `kotlin/`:

   ```sh
   ./gradlew publishToMavenCentral
   ```

   Esto crea un despliegue en el portal que queda pendiente de validación. En
   <https://central.sonatype.com/publishing/deployments> se ve el resultado de las
   comprobaciones (firmas, POM, fuentes y documentación); si todo está en orden, se pulsa
   *Publish*. Si se prefiere que se publique solo en cuanto pase la validación, se usa
   `./gradlew publishAndReleaseToMavenCentral`.
4. Al cabo de unos minutos los ficheros aparecen en
   <https://repo1.maven.org/maven2/io/github/joseluissaorin/spdf/>, y el buscador de
   <https://central.sonatype.com> los muestra algo más tarde.

## Notas

- Una versión publicada en Maven Central no se puede borrar ni sustituir. Si sale mal, se
  publica otra con un número nuevo.
- El jar de documentación va vacío, cosa que Central acepta. Para publicar documentación de
  verdad se puede añadir Dokka (`org.jetbrains.dokka`) y elegir `JavadocJar.Dokka` en la
  configuración del complemento.
- El módulo `spdf-android-device` solo sirve para probar el adaptador de Android en un
  emulador o un dispositivo. No aplica el complemento de publicación y solo entra en la
  compilación con `-Pspdf.androidDevice=true`, así que nunca se sube a Maven Central.
- La clave GPG de Maven Central no tiene nada que ver con la clave Ed25519 con la que la
  biblioteca puede firmar ficheros SPDF (`WriterOptions.signingKey`). Son dos claves
  distintas y ninguna de las dos va en el repositorio.
- `spdf-android` es una biblioteca JVM corriente y no necesita el SDK de Android para
  compilarse ni para publicarse. Las aplicaciones Android que la usen ya tienen `google()`
  entre sus repositorios, que es de donde Gradle descargará la variante Android de
  `androidx.sqlite:sqlite-bundled`.
- Si el repositorio pasa a la organización `spdf-format`, el espacio de nombres
  `io.github.joseluissaorin` sigue valiendo, porque está ligado a la cuenta y no al
  repositorio. Solo hay que actualizar las direcciones del POM en `build.gradle.kts`.
- Para publicar desde GitHub Actions basta con guardar el token y la clave como secretos y
  pasarlos como variables `ORG_GRADLE_PROJECT_mavenCentralUsername`,
  `ORG_GRADLE_PROJECT_mavenCentralPassword`, `ORG_GRADLE_PROJECT_signingInMemoryKey`,
  `ORG_GRADLE_PROJECT_signingInMemoryKeyId` y `ORG_GRADLE_PROJECT_signingInMemoryKeyPassword`.
  Ese flujo de trabajo todavía no existe en el repositorio.
