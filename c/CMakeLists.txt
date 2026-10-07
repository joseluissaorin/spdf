# SPDF for C and C++: builds the Rust C ABI (rust/crates/spdf-ffi) with cargo and links
# the examples, the C++ wrapper and the conformance runner against it.
#
#   cmake -S c -B build && cmake --build build && ctest --test-dir build
#
# Options:
#   SPDF_SHARED=ON         link the shared library (default: static)
#   SPDF_PREBUILT_DIR=dir  use an already built libspdf_ffi from `dir` instead of cargo
cmake_minimum_required(VERSION 3.16)
project(spdf_c VERSION 0.1.0 LANGUAGES C CXX)

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

option(SPDF_SHARED "Link the shared library instead of the static one" OFF)
set(SPDF_RUST_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../rust" CACHE PATH "Rust workspace with crates/spdf-ffi")
set(SPDF_PREBUILT_DIR "" CACHE PATH "Directory with a prebuilt libspdf_ffi (skips cargo)")
set(SPDF_CONFORMANCE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../conformance" CACHE PATH "Conformance suite")

set(SPDF_INCLUDE_DIR "${SPDF_RUST_DIR}/crates/spdf-ffi/include")

if(WIN32)
  set(_static_name "spdf_ffi.lib")
  set(_shared_name "spdf_ffi.dll.lib")
elseif(APPLE)
  set(_static_name "libspdf_ffi.a")
  set(_shared_name "libspdf_ffi.dylib")
else()
  set(_static_name "libspdf_ffi.a")
  set(_shared_name "libspdf_ffi.so")
endif()

if(SPDF_PREBUILT_DIR)
  set(SPDF_LIB_DIR "${SPDF_PREBUILT_DIR}")
else()
  find_program(CARGO cargo REQUIRED)
  set(_target_dir "${CMAKE_BINARY_DIR}/rust-target")
  set(SPDF_LIB_DIR "${_target_dir}/release")
  add_custom_target(spdf_ffi_cargo ALL
    COMMAND "${CARGO}" build --release -p spdf-ffi --manifest-path "${SPDF_RUST_DIR}/Cargo.toml" --target-dir "${_target_dir}"
    BYPRODUCTS "${SPDF_LIB_DIR}/${_static_name}" "${SPDF_LIB_DIR}/${_shared_name}"
    COMMENT "Building the SPDF C ABI (Rust)"
    USES_TERMINAL)
endif()

if(SPDF_SHARED)
  add_library(spdf_ffi SHARED IMPORTED GLOBAL)
  if(WIN32)
    set_target_properties(spdf_ffi PROPERTIES
      IMPORTED_IMPLIB "${SPDF_LIB_DIR}/${_shared_name}"
      IMPORTED_LOCATION "${SPDF_LIB_DIR}/spdf_ffi.dll")
  else()
    set_target_properties(spdf_ffi PROPERTIES IMPORTED_LOCATION "${SPDF_LIB_DIR}/${_shared_name}")
  endif()
else()
  add_library(spdf_ffi STATIC IMPORTED GLOBAL)
  set_target_properties(spdf_ffi PROPERTIES IMPORTED_LOCATION "${SPDF_LIB_DIR}/${_static_name}")
  if(APPLE)
    set(_sys_libs "-framework Security" "-framework CoreFoundation")
  elseif(WIN32)
    set(_sys_libs ws2_32 userenv bcrypt ntdll advapi32)
  else()
    set(_sys_libs pthread dl m)
  endif()
  set_property(TARGET spdf_ffi PROPERTY INTERFACE_LINK_LIBRARIES ${_sys_libs})
endif()
set_target_properties(spdf_ffi PROPERTIES INTERFACE_INCLUDE_DIRECTORIES "${SPDF_INCLUDE_DIR}")

# spdf::spdf: the ABI plus the header-only C++ wrapper.
add_library(spdf INTERFACE)
add_library(spdf::spdf ALIAS spdf)
target_link_libraries(spdf INTERFACE spdf_ffi)
target_include_directories(spdf INTERFACE "${CMAKE_CURRENT_SOURCE_DIR}/include" "${SPDF_INCLUDE_DIR}")
if(NOT SPDF_PREBUILT_DIR)
  add_dependencies(spdf spdf_ffi_cargo)
endif()

# Small JSON helper used by the examples and the runner (not part of the ABI).
add_library(spdf_sjson STATIC src/sjson.c)
target_include_directories(spdf_sjson PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/src")
if(NOT MSVC)
  target_link_libraries(spdf_sjson PUBLIC m)
endif()

if(MSVC)
  add_compile_options(/W4)
else()
  add_compile_options(-Wall -Wextra)
endif()

add_executable(spdf_search examples/search.c)
target_link_libraries(spdf_search PRIVATE spdf spdf_sjson)

add_executable(spdf_validate examples/validate.c)
target_link_libraries(spdf_validate PRIVATE spdf)

add_executable(spdf_search_cpp examples/search.cpp)
target_link_libraries(spdf_search_cpp PRIVATE spdf)

add_executable(spdf_conformance tests/conformance.c)
target_link_libraries(spdf_conformance PRIVATE spdf spdf_sjson)

enable_testing()
add_test(NAME conformance COMMAND spdf_conformance "${SPDF_CONFORMANCE_DIR}" WORKING_DIRECTORY "${CMAKE_BINARY_DIR}")
add_test(NAME example_c COMMAND spdf_search "${SPDF_CONFORMANCE_DIR}/files/quijote.spdf" "lugar de la Mancha")
add_test(NAME example_cpp COMMAND spdf_search_cpp "${SPDF_CONFORMANCE_DIR}/files/quijote.spdf" "hidalgo")
add_test(NAME example_validate COMMAND spdf_validate "${SPDF_CONFORMANCE_DIR}/files/darwin.spdf")
set_tests_properties(example_c PROPERTIES PASS_REGULAR_EXPRESSION "Cervantes Saavedra, 1605")
set_tests_properties(example_cpp PROPERTIES PASS_REGULAR_EXPRESSION "Cervantes Saavedra, 1605")

# pkg-config file for installations of the C ABI.
configure_file(spdf.pc.in "${CMAKE_BINARY_DIR}/spdf.pc" @ONLY)
include(GNUInstallDirs)
install(FILES "${SPDF_INCLUDE_DIR}/spdf.h" include/spdf.hpp DESTINATION "${CMAKE_INSTALL_INCLUDEDIR}")
install(FILES "${SPDF_LIB_DIR}/${_static_name}" DESTINATION "${CMAKE_INSTALL_LIBDIR}" OPTIONAL)
install(FILES "${SPDF_LIB_DIR}/${_shared_name}" DESTINATION "${CMAKE_INSTALL_LIBDIR}" OPTIONAL)
install(FILES "${CMAKE_BINARY_DIR}/spdf.pc" DESTINATION "${CMAKE_INSTALL_LIBDIR}/pkgconfig")
