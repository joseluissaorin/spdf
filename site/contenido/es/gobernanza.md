---
title: Gobernanza y RFC
short: Gobernanza
description: Quién mantiene SPDF, cómo cambia la especificación (con RFC públicas y casos de conformidad), cómo funcionan las versiones, y las licencias y el compromiso sobre patentes.
---

## Quién lo mantiene

SPDF lo edita [José Luis Saorín Ferrer](https://joseluissaorin.com), que lo diseñó para [Scholaris](https://scholaris.joseluissaorin.com) y lo abrió como estándar en octubre de 2026. La intención es entregarlo a un grupo pequeño de mantenedores salidos de las implementaciones y de las instituciones que lo adopten, bajo una organización neutral, en cuanto haya a quién entregarlo.

## Cómo cambia la especificación

Nada cambia en silencio. Todo cambio del formato pasa por una **petición de comentarios** (RFC):

1. Alguien escribe una propuesta en `spec/rfcs/NNNN-titulo-corto.md`: el problema, el cambio, las alternativas que se pensaron y lo que rompe.
2. Se discute en público hasta que se acepta, se rechaza o se retira.
3. Una RFC aceptada entra en la especificación **junto con al menos un caso de conformidad** que la comprueba.
4. Se da por implementada cuando al menos dos implementaciones independientes pasan ese caso.

Las correcciones editoriales (erratas, redacción más clara, ejemplos) no necesitan RFC. Sí la necesita todo lo que cambie qué es un fichero válido, qué debe hacer un lector o qué devuelve una función.

<!-- rfcs -->

## Versiones

- La versión va dentro del fichero: `PRAGMA user_version` vale mayor × 100 + menor × 10 (la 5.0 es 500; la 5.1 sería 510).
- **Las versiones menores solo añaden**: un lector de la 5.0 abre cualquier fichero 5.x, avisa de que la versión menor es más nueva (W105) e ignora lo que no conoce.
- **Las versiones mayores pueden romper**, y los lectores rechazan una versión mayor que no conocen (E002). La anterior sigue siendo legible: todo lector 5.x debe leer aún los ficheros 4.0 y 4.1 heredados de Scholaris.
- Cualquiera puede ampliar el formato sin pedir permiso, con tablas llamadas `x_<proveedor>_<nombre>` declaradas en la tabla `extensions`. Una extensión marcada como obligatoria hace que los lectores que no la conocen rechacen el fichero (E060) en vez de leerlo mal.

## Licencias y patentes

- La especificación y esta documentación se publican con licencia **CC BY 4.0**.
- Todo el código del repositorio (bibliotecas, productor, lector, batería de conformidad, esta web) tiene licencia **MIT o Apache-2.0**, a elegir.
- El autor se compromete públicamente a **no hacer valer ninguna patente** contra las implementaciones de SPDF.
- El tipo de medio `application/vnd.spdf+sqlite3` se registrará en la IANA cuando la especificación sea estable.

## El repositorio

El monorepo reúne la especificación, la batería de conformidad, todas las implementaciones, el productor de referencia, el lector, las integraciones y esta web. Será privado hasta que pasen la especificación, la batería de conformidad y las bibliotecas de primer nivel; después se abre entero. Cada implementación tiene su carpeta y su propio workflow de CI, y ninguna puede tocar la carpeta de otra.
