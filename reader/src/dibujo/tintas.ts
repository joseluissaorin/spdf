/**
 * Las tintas del cuaderno. La paleta de Scholaris (crema, café, los tres
 * colores de la Bauhaus) coincide casi punto por punto con la del escritorio
 * medieval: el café es la tinta ferrogálica, el rojo es el minio de las
 * rúbricas, el azul es la azurita y el amarillo hace de oro. No hay que
 * reconciliar dos paletas: es la misma, separada por quinientos años.
 */
export const TINTAS = {
  papel: '#F5F0E8',
  tinta: '#2C1810',
  lapiz: '#9A8E80',
  rojo: '#C1453B',
  azul: '#2B4C7E',
  amarillo: '#E8A838',
  oro: '#D6A03A',
  negro: '#1A120D',
} as const;

export const CSS_TINTAS = Object.entries(TINTAS).map(([k, v]) => `--d-${k}:${v}`).join(';');
