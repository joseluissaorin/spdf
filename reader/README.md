# Lector SPDF · SPDF Reader

Lee, busca y cita documentos [SPDF](https://spdf.joseluissaorin.com): el facsímil y su
texto lado a lado con el folio impreso, audio y vídeo con la transcripción palabra a
palabra, la cita corta con folio y la referencia bibliográfica en un clic, búsqueda por
palabras y por sentido, y preguntas que solo pueden responder con pasajes del documento.
Gratuito y de código abierto (MIT o Apache 2.0). Sin telemetría y sin conexión por
defecto: los ficheros nunca salen del equipo, y los modelos solo se descargan si lo pides.

Las descargas están en la release
[`reader-v0.1.0`](https://github.com/joseluissaorin/spdf/releases/tag/reader-v0.1.0).

## Instalar

### Web (sin instalar nada)

Abre <https://spdf.joseluissaorin.com/reader/> en Chrome, Edge o cualquier navegador
con WebGPU. Todo ocurre en el navegador: los SPDF se guardan en el almacenamiento privado
del sitio (OPFS) y no se envían a ningún servidor. Se puede instalar como aplicación (PWA)
desde el menú del navegador o desde Ajustes, «Instalar la aplicación». Los modelos locales
(EmbeddingGemma 2, Gemma 4) necesitan WebGPU; sin él, la búsqueda por palabras, las citas y
la lectura funcionan igual.

### macOS (Apple Silicon)

1. Descarga `Lector.SPDF_0.1.0_aarch64.dmg` y ábrelo; arrastra «Lector SPDF» a Aplicaciones.
2. La app está **firmada ad hoc, sin notarizar** (todavía no hay certificado de Developer
   ID). La primera vez, macOS dirá que no puede comprobar el desarrollador: abre
   Aplicaciones, haz **clic derecho en «Lector SPDF» › Abrir** y confirma. Si macOS 15 o
   posterior no ofrece «Abrir», ve a Ajustes del Sistema › Privacidad y seguridad y pulsa
   «Abrir igualmente». Desde la terminal también vale:
   `xattr -dr com.apple.quarantine "/Applications/Lector SPDF.app"`.
3. Los `.spdf` quedan asociados: doble clic en uno y se abre en el lector.

### Windows (x64)

Descarga `Lector.SPDF_0.1.0_x64-setup.exe` (instalador) o el `.msi`. Como no está firmado
con un certificado de Authenticode, SmartScreen avisará: «Más información» › «Ejecutar de
todas formas». Necesita WebView2, que viene con Windows 10 y 11 (si falta, el instalador lo
descarga).

### Linux (x64)

- **AppImage**: descarga `Lector.SPDF_0.1.0_amd64.AppImage`, dale permiso de ejecución
  (`chmod +x Lector.SPDF_0.1.0_amd64.AppImage`) y ábrelo.
- **Debian, Ubuntu y derivadas**: `sudo apt install ./lector-spdf_0.1.0_amd64.deb`.

Necesita WebKitGTK 4.1 (viene en Ubuntu 22.04 y posteriores). La clave de Gemini se guarda en
el llavero del escritorio (Secret Service: GNOME Keyring o KWallet).

### Android (8.0 o posterior)

Descarga `lector-spdf-0.1.0-universal.apk` en el teléfono y ábrelo; Android pedirá permitir
instalar apps de esa fuente. Para leer un `.spdf`, ábrelo desde Archivos o desde otra app con
«Abrir con» › Lector SPDF, o usa el botón de importar. En esta versión, Android no lleva
modelos locales: la búsqueda semántica y las preguntas funcionan con Gemini y tu clave.

### iOS y iPadOS

Compila y se firma para dispositivo, pero aún no está en TestFlight: falta crear la ficha de
la app en App Store Connect (ver «Publicar en TestFlight» más abajo).

## Modelos y privacidad

- Ajustes › Modelos locales lista cada modelo con su tamaño; nada se descarga solo.
  - EmbeddingGemma 2 (vectores; 310 MB en escritorio, 346 MB en la web) permite revectorizar un
    SPDF (menú «⋯» › Revectorizar, eligiendo el recorte Matryoshka 768, 512, 256 o 128) y
    buscar por sentido.
  - Gemma 4 E2B (3,1 GB en escritorio, 2 GB en la web) responde preguntas. Cada afirmación
    lleva la frase literal del SPDF que la respalda, su cita corta, y un juez (el propio
    Gemma 4) que comprueba que el pasaje la sostiene: lo que no se sostiene se descarta.
- La clave de Gemini es opcional. En escritorio e iOS se guarda en el llavero del sistema;
  en Android, en el almacenamiento privado de la app; en la web, solo en memoria salvo que
  marques «Recordarla en este navegador».
- Revectorizar escribe una copia nueva (o el mismo fichero, si lo pides); el resultado se
  valida y siempre es SPDF 5.0.
- Los subrayados y las notas van en un fichero hermano `.spdfa.json` (W3C Web Annotation),
  nunca dentro del SPDF.

## Compilar

Requisitos: Node 22 o posterior, Rust estable, y para los modelos locales cmake y libclang
(en macOS vienen con Xcode; en Linux, `libclang-dev`).

```bash
# Las bibliotecas hermanas, por ruta (se compilan una vez y cada vez que cambian)
(cd ../js && npm ci && npm run build)
(cd ../models/web && npm ci && npm run build)
npm ci

npm run dev                 # interfaz en http://localhost:5173 (con simulacros si faltan las bibliotecas)
npm run build:web           # web estática en dist-web/ (base relativa: sirve bajo /reader/)
npx tauri build --bundles app,dmg      # macOS (.app y .dmg, firma ad hoc)
npx tauri ios build --export-method app-store-connect   # iOS (firma automática del equipo)
npx tauri android build --apk          # Android (APK sin firmar; ver abajo)
npm run fixtures && npx playwright test   # pruebas de extremo a extremo en Chromium
```

Notas que costaron tiempo:

- En macOS, si `xattr` de Miniconda tapa al del sistema, el empaquetado falla («failed to run
  xattr»): `PATH="/usr/bin:$PATH" npx tauri build`.
- llama.cpp usa `@available` y compiler-rt: `src-tauri/build.rs` enlaza `clang_rt.osx`
  (solo macOS; en iOS lo hace Xcode).
- ONNX Runtime para la web no se empaqueta (27 MB, más que el límite de 25 MiB por fichero de
  Cloudflare): transformers.js lo pide a jsDelivr con la versión exacta, y MediaPipe
  también, solo cuando el usuario usa un modelo local.
- Gemma 4 en la web (MediaPipe) corre en el hilo principal: su cargador no funciona dentro
  de un Worker de módulo.

### Firmar la APK

La clave de subida vive fuera del repositorio, en `~/.claude/.secrets/lector-spdf-upload.jks`
(modo 600, alias `lector-spdf`); su contraseña está en el llavero de macOS (servicio
`lector-spdf-android-upload`). Para firmar:

```bash
BT=~/Library/Android/sdk/build-tools/36.0.0
$BT/zipalign -f -p 4 app-universal-release-unsigned.apk alineada.apk
security find-generic-password -s lector-spdf-android-upload -a lector-spdf -w | \
  $BT/apksigner sign --ks ~/.claude/.secrets/lector-spdf-upload.jks --ks-key-alias lector-spdf \
  --ks-pass stdin --out lector-spdf-0.1.0-universal.apk alineada.apk
```

### Publicar en TestFlight (iOS)

El bundle id `com.joseluissaorin.lectorspdf` ya está registrado. La API de App Store
Connect no permite crear la ficha de una app («The resource 'apps' does not allow
'CREATE'»), así que hay un paso manual:

1. En App Store Connect, Apps › «+» › Nueva app: iOS, nombre «Lector SPDF», idioma
   principal Español (España), bundle id `com.joseluissaorin.lectorspdf`, SKU `lector-spdf`.
2. Después, `scripts/subir-testflight.sh` compila la IPA y la sube; aparece en TestFlight
   para pruebas internas en unos minutos (no se envía a revisión).

## Rendimiento

Cifras de la web y de macOS en [RENDIMIENTO.md](RENDIMIENTO.md).
