# Publicar el paquete de Swift

SwiftPM no tiene un registro central obligatorio: un paquete se publica con una
etiqueta semántica en el repositorio de Git, y Swift Package Index (SPI) lo indexa para
que se pueda buscar y para generar la documentación.

## El obstáculo del monorepo

SwiftPM y SPI **solo encuentran un paquete si `Package.swift` está en la raíz del
repositorio**. Aquí vive en `swift/`, así que, tal como está, `.package(url:
"https://github.com/joseluissaorin/spdf", …)` no funciona. Hay dos salidas; la
recomendada es la primera.

1. **Manifiesto fino en la raíz** (recomendada). Un `Package.swift` en la raíz del
   monorepo que declare los mismos productos y apunte a las fuentes de `swift/` con
   `path:`. El resto del repositorio no se ve afectado. Esbozo:

   ```swift
   // swift-tools-version:5.9
   import PackageDescription

   let package = Package(
       name: "SPDF",
       platforms: [.iOS(.v16), .macOS(.v13), .tvOS(.v16), .watchOS(.v9), .visionOS(.v1)],
       products: [
           .library(name: "SPDF", targets: ["SPDF"]),
           .library(name: "SPDFConformance", targets: ["SPDFConformance"]),
           .executable(name: "spdf-swift", targets: ["spdf-cli"]),
       ],
       dependencies: [.package(url: "https://github.com/apple/swift-crypto.git", "3.0.0"..<"5.0.0")],
       targets: [
           .target(name: "CSPDF", path: "swift/Sources/CSPDF",
                   linkerSettings: [.linkedLibrary("sqlite3"), .linkedLibrary("z")]),
           .target(name: "SPDF", dependencies: ["CSPDF",
                   .product(name: "Crypto", package: "swift-crypto", condition: .when(platforms: [.linux]))],
                   path: "swift/Sources/SPDF"),
           .target(name: "SPDFConformance", dependencies: ["SPDF"], path: "swift/Sources/SPDFConformance"),
           .executableTarget(name: "spdf-cli", dependencies: ["SPDF", "SPDFConformance"], path: "swift/Sources/spdf-cli"),
           .testTarget(name: "SPDFTests", dependencies: ["SPDF", "SPDFConformance"], path: "swift/Tests/SPDFTests"),
       ]
   )
   ```

   La raíz no es carpeta de este agente: lo decide el orquestador. Si se adopta, hay que
   mantener los dos manifiestos sincronizados (o dejar solo el de la raíz y que la CI de
   `swift` compile desde allí).

2. **Repositorio espejo** `spdf-swift` generado con `git subtree split --prefix swift`
   en cada versión. Más trabajo de mantenimiento y dos sitios donde mirar; solo
   compensa si el monorepo no puede llevar un manifiesto en la raíz.

## Pasos para una versión

1. Actualizar `SPDF.version` en `swift/Sources/SPDF/Schema.swift`.
2. CI de `swift` en verde: macOS, simulador de iOS y Linux, con la batería completa.
3. Con el repositorio ya **público**, etiquetar. SwiftPM exige etiquetas semánticas
   **sin prefijo** (`0.1.0` o `v0.1.0`), así que la etiqueta del paquete de Swift ocupa
   el espacio de nombres general de etiquetas del monorepo; conviene acordarlo con el
   resto de lenguajes (Go usa `go/v0.1.0`, que no choca):

   ```sh
   git tag 0.1.0
   git push origin 0.1.0
   ```

4. Swift Package Index: añadir la URL del repositorio en
   `https://swiftpackageindex.com/add-a-package` (abre una PR automática en
   `SwiftPackageIndex/PackageList`). Para que SPI genere la documentación, añadir en la
   raíz un `.spi.yml`:

   ```yaml
   version: 1
   builder:
     configs:
       - documentation_targets: [SPDF]
   ```

5. Comprobar en SPI la matriz de compatibilidad (versiones de Swift y plataformas).

## Notas

- El paquete usa el SQLite del sistema: en iOS 16 / macOS 13 es la 3.39, que ya trae
  FTS5, `trigram` (desde la 3.34), `remove_diacritics 2` (desde la 3.27) y
  `sqlite3_deserialize`. Las pruebas pasan en el simulador de iOS 26 y en macOS; las
  versiones antiguas de iOS no se han podido probar en esta máquina (no hay simuladores
  de iOS 16 instalados).
- En Linux hacen falta `libsqlite3-dev` y `zlib1g-dev`, y `swift-crypto` sustituye a
  CryptoKit.
- No hay nada que firmar ni subir: una etiqueta publicada no debe moverse nunca.
