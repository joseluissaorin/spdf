# Publicar la biblioteca de C y C++

C no tiene un registro central. Nada de esto se ha hecho todavía. Caminos, de más a
menos sencillo:

1. **Releases de GitHub** (cuando el repositorio sea público): un workflow que, al
   etiquetar `c-v0.1.0`, compile `libspdf_ffi` para Linux x86_64/aarch64, macOS
   universal y Windows x64, y suba por plataforma un `.tar.gz`/`.zip` con `include/spdf.h`,
   `include/spdf.hpp`, la biblioteca estática y la dinámica, `spdf.pc` y las licencias.
   `cmake --install build --prefix dist` ya deja esa estructura.
2. **Homebrew**: una fórmula `spdf` en un tap propio (`joseluissaorin/homebrew-tap`) que
   compile con cargo y cmake; más adelante, solicitud a homebrew-core.
3. **vcpkg y Conan**: un port (`ports/spdf/portfile.cmake`) y una receta (`conanfile.py`)
   que llamen a este `CMakeLists.txt`; se envían por pull request a sus repositorios.
4. **Distribuciones Linux**: paquetes `libspdf0` y `libspdf-dev` (Debian) o
   `spdf`/`spdf-devel` (Fedora), cuando haya usuarios que lo pidan.

Antes de la primera publicación: fijar la versión de la ABI (soname `libspdf_ffi.so.0`),
decidir si la biblioteca instalada se llama `libspdf` (renombrando `libspdf_ffi` al
empaquetar) y comprobar `ctest` en las tres plataformas.
