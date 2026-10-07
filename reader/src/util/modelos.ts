/**
 * Qué modelo proponer por defecto. Para leer basta lo más ligero de cada familia:
 * - vectores: el ya descargado; si no, el de solo texto más pequeño que no sea una
 *   variante aproximada (q4 escribe `914f7f89+q4`, no el mismo espacio que q8 y GGUF);
 * - lenguaje (y juez, que en local es el mismo Gemma 4): el ya descargado; si no, el más pequeño.
 */
import type { ModeloCatalogo, TipoModelo } from '../nucleo/nucleo';

export function modeloPorDefecto(modelos: ModeloCatalogo[], tipo: TipoModelo): ModeloCatalogo | undefined {
  const de = modelos.filter((m) => m.tipo === tipo);
  const ya = de.find((m) => m.descargado && m.recomendado) ?? de.find((m) => m.descargado);
  if (ya) return ya;
  const candidatos = tipo === 'embed'
    ? de.filter((m) => /text/.test(m.id) && !/q4/.test(m.id))
    : de;
  return [...(candidatos.length ? candidatos : de)].sort((a, b) => a.bytes - b.bytes)[0];
}
