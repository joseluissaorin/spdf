---
title: Validador e inspector
short: Validador
description: Suelta un fichero .spdf para comprobarlo contra la especificación de SPDF y ver lo que hay dentro: ficha, unidades, fragmentos con anclas, figuras y espacios vectoriales. Todo se hace en tu navegador; no se sube nada.
---

<!-- validador -->

## Qué comprueba

El validador hace las mismas comprobaciones, en el mismo orden, que cualquier implementación conforme, e informa con los mismos códigos. Usa `spdf-format`, la implementación en TypeScript, con SQLite compilado a WebAssembly: **el fichero no sale de tu ordenador**.

| Código | Qué significa |
| --- | --- |
| E001 | No es una base de datos SQLite |
| E002 | `application_id` o versión desconocidos |
| E003 | Un fichero 5.0 envuelto en gzip (aviso: los ficheros 5.0 se distribuyen sin comprimir) |
| E010 · E011 | Falta una tabla o una columna obligatoria |
| E012 | Falta una clave obligatoria de `spdf_meta` |
| E013 | `documents` debe tener exactamente una fila |
| E020 | Hay un disparador o una vista |
| E030 · E031 · E032 | Un vector de longitud equivocada, un espacio desconocido o un tipo de dato desconocido |
| E040 · E041 · E042 | Un ancla no válida, un tipo de ancla desconocido o caracteres fuera de rango |
| E050 · E051 | Ficha con JSON no válido, o que no es un ítem CSL |
| E060 | Una extensión obligatoria que este lector no conoce |
| E070 | El índice de texto completo no coincide con los fragmentos |
| E080 · E081 · E082 | No coincide un blob, la huella del contenido o la firma |
| E090 | Las unidades no están numeradas seguidas desde 1 |
| W100–W110 | Avisos: perfil semántico sin vectores, perfil multimedia sin tiempos, versión menor más nueva, fichero heredado… |

## Desde la línea de órdenes

Todas las implementaciones validan también. Con la de TypeScript:

```sh
npx spdf-format validate darwin-origin.spdf
```
