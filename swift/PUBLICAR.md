# Publicar el paquete de Swift

SwiftPM no tiene un registro central obligatorio: un paquete se publica con una
etiqueta semántica en el repositorio de Git, y Swift Package Index (SPI) lo indexa para
que se pueda buscar y para generar la documentación.

## El manifiesto de la raíz

SwiftPM y Swift Package Index **solo encuentran un paquete si `Package.swift` está en la
raíz del repositorio**. Por eso hay dos manifiestos con los mismos productos:

- `Package.swift` en la raíz del monorepo (autorizado por el orquestador): apunta con
  `path:` a `swift/Sources/…` y `swift/Tests/…`. Es el que usa quien escribe
  `.package(url: "https://github.com/joseluissaorin/spdf", from: "0.1.0")`.
- `swift/Package.swift`, para trabajar dentro de `swift/` sin compilar desde la raíz.

Hay que mantenerlos sincronizados; la CI de `swift` compila y prueba los dos. El
`.spi.yml` de la raíz le dice a SPI que genere la documentación del objetivo `SPDF`.

## Pasos para una versión

1. Actualizar `SPDF.version` en `swift/Sources/SPDF/Schema.swift`.
2. CI de `swift` en verde: macOS, simulador de iOS y Linux, con la batería completa.
3. Con el repositorio ya **público**, etiquetar. El monorepo sigue un tren de versiones
   común (DECISIONES.md): una etiqueta semántica sin prefijo (`0.1.0`, `0.2.0`…) marca
   una publicación coordinada de todas las bibliotecas con el mismo número, y es la que
   lee SwiftPM. Go usa a la vez `go/v0.1.0` con el mismo número.

   ```sh
   git tag 0.1.0
   git push origin 0.1.0
   ```

4. Swift Package Index: añadir la URL del repositorio en
   `https://swiftpackageindex.com/add-a-package` (abre una PR automática en
   `SwiftPackageIndex/PackageList`). El `.spi.yml` de la raíz ya pide la documentación
   del objetivo `SPDF`.

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
