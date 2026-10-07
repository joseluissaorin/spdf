# spdf-build: resultados medidos

Medido el 7 de octubre de 2026 en un Mac con Apple M4 Max y 36 GB de memoria, con red
doméstica. Validador: `spdf-format` 0.1.0 de este repositorio, que pasa la batería de
conformidad 0.4.0 (309 casos). Todas las cifras salen de los guiones de `bench/`; al final
se explica cómo repetirlas.

Motores medidos:

- **Local** (`--engine local --offline`): EmbeddingGemma 2 en MPS con bfloat16 (768
  dimensiones), Gemma 4 E4B instruct cuantizado a 4 bits con mlx-vlm (`mlx-community/
  gemma-4-e4b-it-4bit`, 1120 tokens de imagen por página) y whisper large-v3-turbo con
  mlx-whisper.
- **Con clave** (`--engine gemini`): `gemini-flash-latest`, que hoy resuelve a
  `gemini-3.8-flash`, sin razonamiento interno (`thinkingBudget: 0`, un tercio del
  tiempo y la misma transcripción), y `gemini-embedding-2` a 768 dimensiones.
- **Referencias baratas**: Tesseract 5 (solo con el modelo inglés, el único instalado
  aquí) y Gemma 4 E2B.

## Corpus

Todo es de dominio público. El detalle y las fuentes están en
`~/Developer/spdf-corpus/CORPUS.md` y `antiguo2/NOTAS.md`.

| Obra | Tipo | Tamaño | Por qué es de dominio público |
|---|---|---|---|
| Diego de Torres Villarroel, *Sala de mugeres* (Salamanca, 1737). Internet Archive b30359156 | PDF escaneado | 72 págs. | 1737; Public Domain Mark |
| Joaquín Manuel Fos, *Instrucción metódica sobre los mueres* (Madrid, 1790). IA gri_33125010872287 | PDF escaneado, con romanos y láminas | 146 págs. | 1790; NOT_IN_COPYRIGHT |
| NIST SP 800-63B-4, *Digital Identity Guidelines* (2025) | PDF digital | 129 págs. | obra federal de EE. UU., 17 U.S.C. §105 |
| Emilia Pardo Bazán, «Dos cenas», leído por Eva Folch (LibriVox, 2021), con el texto de Gutenberg 55812 | audio MP3 | 18 min 40 s | grabación dedicada al dominio público; autora muerta en 1921 |
| Miguel de Unamuno, *La tía Tula* (Madrid, 1921). Gutenberg 44358 | EPUB 3 con lista de páginas | 191 págs. impresas | autor muerto en 1936 |

Además, para los fallos que encontró el agente de SPDF Commons: Galileo, *Sidereus nuncius*
(1610, IA Sidereusnuncius00Gali), Gilman, *The Yellow Wall Paper* (1901, IA
yellowwallpaper1901gilm), Kafka, *Die Verwandlung* (Gutenberg 22367) y Baudelaire, *Les
Fleurs du mal* (1857, IA lesfleursdumal00bauduoft).

## Validez

Las 10 salidas finales de las cuatro obras de base (cada una con los dos motores), las de Fos
y las 16 entradas sintéticas del informe de conformidad (`bench/conformance_producer.py`,
que en CI se sube como `conformance-producer`) son **válidas sin errores ni avisos** con
`spdf-format` y con el oráculo `conformance/tools/spdfref.py`. Perfiles declarados: `core
semantic` (y `media` en el audio); todos los fragmentos llevan vector.

## Folios

La verdad es manual. En el libro de 1737 se identificaron los tramos y se comprobaron a ojo
20 páginas: 9 el agente que montó el corpus y 11 yo, recortando los titulillos. En la
física 9 se lee «Pag. 1»; desde ahí, folio = física − 8; las físicas 1-8 y 72 no llevan
número. En Fos, el agente la comprobó página a página en los titulillos (19 romanos, 84
arábigos, 12 láminas con sus vueltos en blanco). En el NIST miré 10 pies de página. Todas las
medidas son **sin las etiquetas de página del PDF** (`--no-labels`), que en los dos
escaneados ya traen la respuesta.

| Obra | Lector | Correctos | Leídos / deducidos / sin folio |
|---|---|---|---|
| Torres Villarroel 1737 | Gemini | **72/72** | 63 / 0 / 9 |
| Torres Villarroel 1737 | Gemma 4 E4B | **72/72** | 55 / 8 / 9 |
| Torres Villarroel 1737 | Tesseract (inglés) | **72/72** | 24 / 39 / 9 |
| Fos 1790 | Gemini | **144/146** | 100 / 2 / 44 |
| Fos 1790 | Gemma 4 E4B | FOS_LOCAL |
| NIST 2025 | capa de texto | **129/129** | 125 / 0 / 4 |

Las dos diferencias de Fos son decisiones, no fallos de lectura: son vueltos en blanco
(físicas 32 y 116) que cuentan en la paginación (xx y 84). Un catálogo los registra entre
corchetes; el productor deja sin folio cualquier página en blanco, porque no hay nada que
citar en ella. En el NIST, las cuatro primeras páginas llevan en el PDF las etiquetas «I, I,
I, II» sin número impreso. Esas etiquetas se descartan: un tramo de etiquetas que ninguna
página confirma con lo que se ve no se sigue.

**Lo que salió mal antes de llegar ahí.** Las primeras pasadas dieron 98,6 % (Gemini),
87,5 % (Gemma) y 88,9 % (Tesseract) en el libro de 1737. Las causas fueron cinco:

- seis páginas de preliminares leídas de la mala capa OCR del escaneo, en vez de con visión;
- tres páginas de prólogo sin número a las que la convención heredada de Scholaris contaba
  como i, ii, iii;
- un «i» de ruido del OCR en la portada, que abría una zona romana falsa;
- en Gemma, unas signaturas manuscritas de la biblioteca («J. XVIII») tomadas por titulillo;
- la contracubierta en blanco, en la que Gemma copió el texto de la portada.

Cada causa tiene ahora su regla y su prueba:

- en un escaneo, la capa OCR va también a visión, salvo con `--trust-ocr`;
- un tramo sin ninguna lectura no recibe folio;
- una zona romana necesita dos lecturas, o una fuerte cuyo «i» caiga dentro del libro;
- las páginas en blanco se detectan midiendo la tinta y no se mandan a ningún modelo.

Las tres lecturas guardadas (`--save-reading`) se volvieron a pasar con el código final
(`--reuse-reading`), sin pagar otra vez la visión.

**Casos de Commons.** En el *Sidereus nuncius* (foliado), la física 36 salía sin folio y la
40 como «16v». Ahora la 36 es [16v] y las físicas 37-40, hojas insertas sin numerar, quedan
sin folio. Ojo: en este ejemplar las hojas insertas llevan texto con titulillo y reclamos,
así que no se pueden distinguir contando. El hueco queda sin folio salvo el verso de la hoja
16: nada puede ir entre las dos caras de una hoja. En Gilman, las 12 páginas posteriores a
la p. 55 (guardas, lomo, papeleta DATE DUE, código de barras) salían con [56]-[67]; ahora no
llevan folio. La regla general es esta:

1. Cada página se clasifica antes de deducir nada: texto del libro, lámina, en blanco,
   cubierta, aparato de biblioteca o carta de color.
2. Solo el texto del libro recibe un folio deducido.
3. Tras el último folio leído se sigue contando solo con pruebas: un titulillo, o texto que
   continúa (frase o palabra partida, reclamo).
4. Un hueco que no cuadra se queda sin folio.

**EPUB.** *La tía Tula*: las 191 páginas marcadas en el contenido están en el fichero, y
190 empiezan exactamente donde el marcador (la otra es un falso aviso del comprobador, por un
título repetido). La primera versión del lector fiaba la lista de páginas del EPUB, que en
Gutenberg omite páginas. Se fundían las pp. 24, 75, 162 y 174 con la anterior, y se citaban
con su folio: un **fallo de cita** que encontró Commons en Kafka (11 de 71 páginas omitidas, y
la p. 75 perdida por la clase CSS `page-break-after`). Ahora todo marcador del contenido es un
salto, esté o no en la lista. Kafka sale con 71/71 páginas y la p. 23 empieza en «Leibe zu
spüren bekommt».

**Fragmentos.** Commons encontró otro fallo de cita: un fragmento que une una página con
folio y otra sin él se citaba por el extremo equivocado. Pasaba con la p. 75 de Kafka unida
a la licencia de Gutenberg, que se citaba «p. 74». Ahora un fragmento nunca cruza ese cambio:
0 fragmentos mixtos en Kafka, Galileo y Gilman.

## Texto leído

Página de control: la física 9 del libro de 1737, transcrita a mano (1287 caracteres, la s
larga como «s», ortografía de la época intacta). Error de caracteres (CER) exacto y plegado
(sin mayúsculas, tildes ni puntuación), y errores por palabra con el texto plegado:

| Lector | CER exacto | CER plegado | WER plegado | «ſ» leída como «f» | Segundos por página |
|---|---|---|---|---|---|
| Gemini | 1,2 % | 0,6 % | 1,4 % | 0 | 1,0-1,5 (6 en paralelo, 4 págs. por llamada) |
| Gemma 4 E4B | 4,7 % | 2,7 % | 20,1 % | 7 | 13,7 (1737), 6,3 (Fos) |
| Gemma 4 E2B | E2B_CER | E2B_SPEED |
| Tesseract (inglés) | 53,3 % | 49,4 % | 80,8 % | 26 | 1,3 (CPU) |

Gemma 4 E4B lee el orden de las columnas y los folios, pero confunde la s larga con la «f»
(«defcuido»). A menudo deja los saltos de línea, que el productor une cuando hay guiones de
corte. También alucina: titulillos que no están, el texto de la portada en una página en
blanco (ya no llega a ella) y la lengua («la» para un libro castellano; ahora manda la
estadística de palabras vacías del texto). La capa modernizada (`search_text`) compensa en
la búsqueda la s larga mal leída: «mugeres», «Quando», «assi» o «defcuido» casan con las
consultas modernas. Tesseract, sin modelo español ni de letra antigua, sirve para folios pero
no para el texto.

## Transcripción

«Dos cenas» contra el texto de Gutenberg, plegado. Se recortan el preámbulo de LibriVox y la
despedida, que no están en el libro:

| Transcriptor | WER plegado | Tiempo (18 min 40 s) | Lectora |
|---|---|---|---|
| whisper large-v3-turbo (mlx) | 4,2 % | 47-51 s (≈ 23 × tiempo real) | «Eva Folk» (tal como suena) |
| Gemini | 3,1-4,9 % en cuatro pasadas, 3,9 % la final | 66-88 s | «Eva Folch» |

whisper no separa voces. Si el modelo dice que la grabación tiene una sola voz con nombre, y
ese nombre se oye en la propia grabación («grabado por…»), se asigna a todas las unidades.
Gemini separa voces, pero hubo que enseñarle dos cosas. Primero, que los personajes de un
cuento leído no son voces (atribuyó diálogos a «Lucía»). Segundo, que una frase no es un
nombre. Las dos grafías del nombre de la lectora salen mal de oído («Folk», «Foulk»). Con red,
el catálogo de Internet Archive lista a la lectora como «evafolch» y corrige la grafía; sin
red no hay forma de saberlo. Los tiempos por palabra de whisper son los del modelo. Los de
Gemini se reparten dentro de cada frase por longitud, y la procedencia lo dice
(`word_timing: interpolated`).

## Ficha bibliográfica

Campos comprobados a mano (título, primer autor, año, editorial o impresor, lugar, lengua,
tipo CSL, DOI y lectora, según la obra):

| Obra | Local, sin red | Gemini, con catálogos |
|---|---|---|
| Torres Villarroel 1737 | 5/6: el título sale «Tercera parte de los desauciados…» sin «Sala de mugeres», y el autor como «Torres Villarroël» | 6/6 |
| Fos 1790 | FOS_LOCAL_MD | título, autor, 1790, Madrid e impresor («Imprenta de la viuda de D. Joachîn Ibarra») correctos |
| NIST 2025 | 7/7 (todo leído de las páginas) | 7/7 (Crossref por DOI) |
| «Dos cenas» | 4/5 (lectora «Eva Folk») | 5/5 (fecha de la grabación, 14-3-2021, de Internet Archive) |
| *La tía Tula* | 6/7 (falta la editorial) | 7/7 (Open Library confirma 1921) |

Total: 22/25 en local y 25/25 con clave. Las fichas guardan, campo a campo, de dónde
salieron (`spdf.provenance`) y con qué confianza.

## Tiempos

Construcción completa, en segundos (la lectura con visión del escaneado local se midió en la
primera pasada; las demás cifras son de las pasadas finales):

| Obra | Local | Gemini | Lo que más pesa |
|---|---|---|---|
| Torres Villarroel, 72 págs. | 1110 | 147 | lectura con visión (988 s en local) |
| Fos, 146 págs. | FOS_LOCAL_TIME | 154 | lectura con visión |
| NIST, 129 págs. | 298 | 83 | líneas de contexto (271 s y 71 s) |
| *La tía Tula*, 191 págs. | 188 | 36 | líneas de contexto (166 s y 29 s) |
| «Dos cenas», 18 min 40 s | 107 | 80 | transcripción |

Por página:

- capa de texto de un PDF digital: unos 10 ms (NIST, 129 págs. en 1,3 s);
- EPUB: menos de 5 ms;
- vectores con EmbeddingGemma 2: unos 50 ms por fragmento, contando la carga del modelo;
- memoria máxima en local: 11-13 GB.

Con los motores simulados (las pruebas y la CI), el NIST entero se construye en 1,5 s.

Tamaño de los ficheros:

- NIST: 2,4 MB;
- *La tía Tula*: 1,5 MB;
- audio: 0,3 MB;
- Torres Villarroel: 13,6 MB, de los que 11,7 son el facsímil de las páginas (1200 px,
  JPEG 65) y 0,56 los vectores; el original pesa 9,8 MB;
- Fos: 17,6 MB.

## Sin conexión

Las cinco construcciones locales finales se hicieron con `--offline`: 0 intentos de conexión
fuera de la máquina (el informe JSON lo cuenta y la construcción falla si no es 0). Una
prueba lo exige, otra comprueba que la guarda bloquea una conexión real y deja pasar
localhost. El motor compatible con OpenAI se probó en vivo contra el Ollama local (bge-m3 y
qwen3-vl): pasa como «sin conexión» porque el servidor está en localhost.

## Lo que queda abierto

- **Gemma 4 E4B lee peor que Gemini** el texto antiguo (CER 4,7 % frente a 1,2 % en la
  página de control) y es unas diez veces más lento por página. Lo que cuesta en local son
  las líneas de contexto, una llamada por cada 12 fragmentos. `--no-context` deja líneas
  extractivas y quita el 70-90 % del tiempo.
- **Diarización local**: no hay. Solo se nombra la voz única; varias voces sin diarización
  quedan sin etiqueta. EmbeddingGemma 2 tiene codificador de audio, pero no está probado para
  separar hablantes.
- **Tiempos por palabra con Gemini**: interpolados dentro de cada frase.
- **Filtros de Gemini**: rechaza algunos tramos («PROHIBITED_CONTENT», «RECITATION»). En el
  texto hay reintento y aviso. En el audio, el tramo se parte hasta 60 s y lo que siga
  fallando se omite con aviso. En las líneas de contexto (un grupo de *La tía Tula*) se usa
  la línea extractiva.
- **Folios**: no hay juez de dudas (el «Jev» de Scholaris o Gemma por logits); los huecos
  dudosos se dejan sin folio. La disposición a doble página y la foliación solo están
  probadas con libros sintéticos y con Galileo. Los vueltos en blanco que cuentan en la
  paginación quedan sin folio por decisión.
- **Figuras**: en PDF digitales solo se detectan las imágenes incrustadas, no los dibujos
  vectoriales. En los escaneos, las regiones las da el modelo de visión.
- **Diapositivas**: la imagen de cada diapositiva necesita LibreOffice, que no hay en esta
  máquina; el texto, las notas y las imágenes incrustadas sí salen.
- **HEIC**: Pillow no lo abre sin `pillow-heif`.
- **Vídeo**: probado solo con una señal de prueba sintética (fotogramas clave y unidades con
  imagen). No hay ningún vídeo real en el corpus.
- **Muestra pequeña**: cinco obras de base y cuatro casos de Commons. Las reglas de folios se
  afinaron mirando estos libros, así que las cifras de 100 % hay que leerlas como «sin
  errores en lo medido», no como garantía. Commons, con 12 obras más, es la siguiente
  medida.

## Cómo repetirlo

```sh
cd producer
uv sync --extra local --extra test
uv run pytest -q                                      # 57 pruebas, sin modelos
uv run python bench/conformance_producer.py           # 16 entradas sintéticas, validadas dos veces
bench/run_final_local.sh                              # tanda local (corpus en ~/Developer/spdf-corpus)
GEMINI_API_KEY=… OPENALEX_API_KEY=… bench/run_final_gemini.sh
uv run python bench/folio_truth.py bench/out/final-antiguo-gemini.spdf bench/truth-antiguo.json
uv run python bench/cer.py bench/out/antiguo-gemini.reading.json 9 bench/ref-antiguo-p9.txt
uv run python bench/wer.py bench/out/final-librivox-gemini.spdf ~/Developer/spdf-corpus/librivox/dos-cenas_lineas-1588-1824.txt
uv run python bench/epub_pages.py bench/out/final-gutenberg-gemini.spdf ~/Developer/spdf-corpus/gutenberg/pg44358-la-tia-tula.epub
uv run python bench/metadata_score.py bench/out/final-nist-gemini.spdf nist
```
