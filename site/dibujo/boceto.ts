/**
 * El cuaderno. Un dibujo es una lista de cosas hechas a mano, en el orden en
 * que se hicieron: primero las líneas de construcción a lápiz, luego la pluma,
 * luego los toques de rojo y de oro, y las notas al margen. Las coordenadas las
 * escribe quien dibuja (ver `dibujos/`); aquí solo se les pone el pulso.
 *
 * Además de la mano hay formas planas, recortadas a la manera de la Bauhaus
 * (el cuadrado de Malévich, el círculo azul de Kandinski): el boceto las
 * dibuja encima, las mide y las comenta, como un cuaderno de taller.
 */
import { semillaDe, generador, entre } from './azar';
import {
  type Punto, curva, quebrada, temblar, contorno, simplificar, caminoCerrado, caminoAbierto, longitud, rayas, num,
} from './pluma';

export type { Punto };

/** Las tintas del cuaderno. Los valores viven en CSS (`--d-…`), aquí solo sus nombres. */
export type Tinta = 'tinta' | 'lapiz' | 'rojo' | 'oro' | 'azul' | 'papel';
export type Color = 'rojo' | 'azul' | 'amarillo' | 'negro' | 'oro' | 'tinta' | 'papel';

export interface Trazo {
  tipo: 'trazo';
  p: readonly Punto[];
  tinta: Tinta;
  /** Grosor máximo de la pluma (o del lápiz), en unidades del dibujo. */
  g: number;
  /** Cuántas veces pasa la mano por la misma línea. Las pasadas no coinciden del todo. */
  pasadas: number;
  cerrado: boolean;
  /** Trazado con regla: línea quebrada en lugar de curva. */
  recto: boolean;
  temblor: number;
}

export interface Plano {
  tipo: 'plano';
  /** Polígono escrito a mano o círculo. */
  p?: readonly Punto[];
  circulo?: { c: Punto; r: number };
  color: Color;
  opacidad: number;
  /** Encima de la tinta, multiplicando (los toques de color sueltos). */
  encima: boolean;
  /** Aguada: el pincel no llena del todo, el borde se escapa. */
  aguada: boolean;
}

export interface Sombra {
  tipo: 'sombra';
  zona: readonly Punto[];
  angulo: number;
  paso: number;
  cobertura: number;
  tinta: Tinta;
  g: number;
}

/** Un texto en las dos lenguas de la portada (o el mismo para las dos). */
export type Bilingue = string | { readonly es: string; readonly en: string };
export type Lengua = 'es' | 'en';
export const enLengua = (b: Bilingue, l: Lengua): string => (typeof b === 'string' ? b : b[l]);

export interface Nota {
  tipo: 'nota';
  x: number;
  y: number;
  texto: Bilingue;
  tam: number;
  giro: number;
  tinta: Tinta;
  ancla: 'start' | 'middle' | 'end';
}

export type Elemento = Trazo | Plano | Sombra | Nota;

export interface Dibujo {
  id: string;
  ancho: number;
  alto: number;
  /** Para lectores de pantalla: lo que se ve, dicho con cuidado. */
  titulo: Bilingue;
  descripcion: Bilingue;
  elementos: Elemento[];
  /** Segundos que tarda la mano en hacerlo entero cuando se anima. */
  duracion?: number;
  /** Desregistro de la capa de color, como dos pasadas de imprenta. */
  desregistro?: Punto;
  /** Encuadre [x, y, ancho, alto] si solo se enseña una parte de la hoja. */
  caja?: readonly [number, number, number, number];
}

/* ------------------------------------------------------------------ */
/* Atajos para dibujar                                                 */
/* ------------------------------------------------------------------ */

type OpcionesTrazo = Partial<Omit<Trazo, 'tipo' | 'p'>>;

/** Pluma de tinta de hierro. */
export const tinta = (p: readonly Punto[], o: OpcionesTrazo = {}): Trazo => ({
  tipo: 'trazo', p, tinta: 'tinta', g: 2.4, pasadas: 1, cerrado: false, recto: false, temblor: 0.7, ...o,
});
/** Lápiz de construcción: fino, gris, que se ve por debajo. */
export const lapiz = (p: readonly Punto[], o: OpcionesTrazo = {}): Trazo => ({
  tipo: 'trazo', p, tinta: 'lapiz', g: 0.9, pasadas: 1, cerrado: false, recto: true, temblor: 0.5, ...o,
});
/** Rúbrica: pluma con minio. */
export const rojo = (p: readonly Punto[], o: OpcionesTrazo = {}): Trazo => tinta(p, { tinta: 'rojo', ...o });
export const azul = (p: readonly Punto[], o: OpcionesTrazo = {}): Trazo => tinta(p, { tinta: 'azul', ...o });
export const oro = (p: readonly Punto[], o: OpcionesTrazo = {}): Trazo => tinta(p, { tinta: 'oro', ...o });
/** Tinta clara, para dibujar encima de una forma oscura. */
export const blanco = (p: readonly Punto[], o: OpcionesTrazo = {}): Trazo => tinta(p, { tinta: 'papel', ...o });

export const plano = (p: readonly Punto[], color: Color, o: Partial<Omit<Plano, 'tipo' | 'p' | 'color'>> = {}): Plano => ({
  tipo: 'plano', p, color, opacidad: 1, encima: false, aguada: false, ...o,
});
export const disco = (c: Punto, r: number, color: Color, o: Partial<Omit<Plano, 'tipo' | 'circulo' | 'color'>> = {}): Plano => ({
  tipo: 'plano', circulo: { c, r }, color, opacidad: 1, encima: false, aguada: false, ...o,
});
export const sombra = (zona: readonly Punto[], angulo: number, paso: number, o: Partial<Omit<Sombra, 'tipo' | 'zona' | 'angulo' | 'paso'>> = {}): Sombra => ({
  tipo: 'sombra', zona, angulo, paso, cobertura: 1, tinta: 'tinta', g: 1, ...o,
});
export const nota = (x: number, y: number, texto: Bilingue | readonly [string, string], o: Partial<Omit<Nota, 'tipo' | 'x' | 'y' | 'texto'>> = {}): Nota => ({
  tipo: 'nota', x, y, texto: Array.isArray(texto) ? { es: texto[0], en: texto[1] } : (texto as Bilingue), tam: 16, giro: 0, tinta: 'lapiz', ancla: 'start', ...o,
});

/** Puntos de una circunferencia (para el compás y las curvas cerradas). */
export function circulo(c: Punto, r: number, n = 12, desde = 0, hasta = 360, ry = r): Punto[] {
  const pts: Punto[] = [];
  for (let i = 0; i <= n; i++) {
    const a = ((desde + ((hasta - desde) * i) / n) * Math.PI) / 180;
    pts.push([c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * ry]);
  }
  return pts;
}

/** Desplaza y escala una lista de puntos (para reutilizar una forma dibujada una vez). */
export function mover(p: readonly Punto[], dx: number, dy: number, s = 1): Punto[] {
  return p.map(([x, y]) => [x * s + dx, y * s + dy] as Punto);
}

/* ------------------------------------------------------------------ */
/* Del cuaderno al SVG                                                 */
/* ------------------------------------------------------------------ */

const escapar = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

interface Pieza {
  capa: 'planos' | 'lapiz' | 'tinta' | 'color' | 'encima' | 'notas';
  svg: string;
  /** Línea central para la máscara que «dibuja» la tinta. */
  centro?: { d: string; ancho: number; largo: number };
  largo: number;
}

const fill = (c: Color | Tinta) => `var(--d-${c})`;

function piezasDeTrazo(t: Trazo, semilla: number): Pieza[] {
  const piezas: Pieza[] = [];
  const base = t.recto ? quebrada(t.p, t.cerrado) : curva(t.p, t.cerrado);
  for (let k = 0; k < t.pasadas; k++) {
    const s = semilla + k * 7919;
    const azar = generador(s);
    // La segunda pasada se desvía un poco más y es más fina: la mano repasa sin calcar.
    const pulso = { temblor: t.temblor * (1 + k * 0.9), desborde: (t.tinta === 'lapiz' ? 6 : 2.5) * (k ? 1.6 : 1) };
    let poli = temblar(base, s, pulso, t.cerrado);
    if (k > 0) {
      const dx = entre(azar, -1, 1) * t.g * 0.6, dy = entre(azar, -1, 1) * t.g * 0.6;
      poli = poli.map(([x, y]) => [x + dx, y + dy] as Punto);
    }
    const largo = longitud(poli);
    if (t.tinta === 'lapiz') {
      const d = caminoAbierto(simplificar(poli, 0.3));
      const op = num(entre(azar, 0.5, 0.8) * (k ? 0.7 : 1));
      piezas.push({ capa: 'lapiz', largo, svg: `<path class="tl" pathLength="1" d="${d}" stroke-width="${num(t.g * (k ? 0.8 : 1))}" opacity="${op}"/>` });
      continue;
    }
    const g = t.g * (k ? 0.62 : 1);
    const forma = simplificar(contorno(poli, g, entre(azar, 0, 1), t.cerrado), 0.3);
    const capa = t.tinta === 'tinta' || t.tinta === 'papel' ? 'tinta' : 'color';
    piezas.push({
      capa,
      largo,
      svg: `<path d="${caminoCerrado(forma)}" fill="${fill(t.tinta)}"${k ? ' opacity=".8"' : ''}/>`,
      centro: { d: caminoAbierto(simplificar(poli, 0.8)), ancho: g * 1.9 + 3, largo },
    });
  }
  return piezas;
}

function piezaDePlano(p: Plano, semilla: number): Pieza {
  const azar = generador(semilla);
  // Hasta lo plano lleva mano: el borde de un recorte nunca es una regla perfecta.
  let pts: Punto[];
  if (p.circulo) {
    const { c, r } = p.circulo;
    pts = curva(circulo(c, r, 18, 0, 340), true, 6);
  } else {
    pts = quebrada(p.p ?? [], true, 8);
  }
  const borde = p.aguada ? 2.6 : 0.6;
  const poli = temblar(pts, semilla, { temblor: borde, desborde: 0 }, true);
  const d = caminoCerrado(simplificar(poli, 0.25));
  const largo = longitud(poli);
  const op = p.aguada ? num(p.opacidad * entre(azar, 0.75, 0.9)) : num(p.opacidad);
  return {
    capa: p.encima ? 'encima' : 'planos',
    largo,
    svg: `<path class="pl${p.aguada ? ' ag' : ''}" d="${d}" fill="${fill(p.color)}"${op !== '1' ? ` opacity="${op}"` : ''}/>`,
  };
}

function piezasDeSombra(s: Sombra, semilla: number): Pieza[] {
  const lineas = rayas(s.zona, s.angulo, s.paso, s.cobertura, semilla);
  return lineas.flatMap((l, i) =>
    piezasDeTrazo({ tipo: 'trazo', p: l, tinta: s.tinta, g: s.g, pasadas: 1, cerrado: false, recto: true, temblor: 0.35 }, semilla + i * 31),
  );
}

function piezaDeNota(n: Nota, lengua: Lengua): Pieza {
  const texto = enLengua(n.texto, lengua);
  const giro = n.giro ? ` transform="rotate(${num(n.giro)} ${num(n.x)} ${num(n.y)})"` : '';
  const lineas = texto.split('\n');
  const cuerpo = lineas.length === 1
    ? escapar(texto)
    : lineas.map((l, i) => `<tspan x="${num(n.x)}"${i ? ` dy="${num(n.tam * 1.05)}"` : ''}>${escapar(l)}</tspan>`).join('');
  return {
    capa: 'notas',
    largo: 0,
    svg: `<text class="nt" x="${num(n.x)}" y="${num(n.y)}" font-size="${num(n.tam)}" fill="${fill(n.tinta)}"${n.ancla !== 'start' ? ` text-anchor="${n.ancla}"` : ''}${giro}>${cuerpo}</text>`,
  };
}

export interface OpcionesSvg {
  /** Clase extra para el elemento <svg>. */
  clase?: string;
  /** Segundos antes de empezar a dibujar (cuando se anima). */
  espera?: number;
  /** Decorativo: sin título ni descripción para lectores de pantalla. */
  decorativo?: boolean;
  lengua?: Lengua;
  /** Para usar el mismo dibujo dos veces en una página sin que se pisen las máscaras. */
  sufijo?: string;
}

/**
 * Convierte un dibujo en SVG. El orden de la mano se conserva: cada trazo lleva
 * en `--d` el segundo en que empieza y en `--t` cuánto dura, proporcional a su
 * largo, de modo que al animarse la pluma va a la velocidad de una pluma.
 */
export function aSvg(dibujo: Dibujo, opciones: OpcionesSvg = {}): string {
  const raiz = semillaDe(dibujo.id);
  const lengua = opciones.lengua ?? 'es';
  const piezas: Pieza[] = [];
  dibujo.elementos.forEach((e, i) => {
    const s = (raiz + Math.imul(i + 1, 0x9e3779b1)) >>> 0;
    if (e.tipo === 'trazo') piezas.push(...piezasDeTrazo(e, s));
    else if (e.tipo === 'plano') piezas.push(piezaDePlano(e, s));
    else if (e.tipo === 'sombra') piezas.push(...piezasDeSombra(e, s));
    else piezas.push(piezaDeNota(e, lengua));
  });

  // El tiempo: el lápiz primero y deprisa; luego la tinta y el color, en el orden en que se escribieron.
  const total = dibujo.duracion ?? 3.2;
  const espera = opciones.espera ?? 0;
  const tLapiz = total * 0.28;
  const tTinta = total - tLapiz * 0.6;
  const largoLapiz = piezas.filter((p) => p.capa === 'lapiz').reduce((a, p) => a + p.largo, 0) || 1;
  const largoTinta = piezas.filter((p) => p.capa === 'tinta' || p.capa === 'color').reduce((a, p) => a + p.largo, 0) || 1;
  let acL = 0, acT = 0;
  const tiempo = (p: Pieza): { d: number; t: number } | null => {
    if (p.capa === 'lapiz') {
      const d = espera + (acL / largoLapiz) * tLapiz;
      acL += p.largo;
      return { d, t: Math.max(0.12, (p.largo / largoLapiz) * tLapiz) };
    }
    if (p.capa === 'tinta' || p.capa === 'color') {
      const d = espera + tLapiz * 0.6 + (acT / largoTinta) * tTinta;
      acT += p.largo;
      return { d, t: Math.max(0.1, (p.largo / largoTinta) * tTinta) };
    }
    return null;
  };

  const capas: Record<Pieza['capa'], string[]> = { planos: [], lapiz: [], tinta: [], color: [], encima: [], notas: [] };
  const mascaraTinta: string[] = [], mascaraColor: string[] = [];
  let nPlano = 0;
  for (const p of piezas) {
    const t = tiempo(p);
    const estilo = (d: number, dur: number) => ` style="--d:${Math.round(d * 100) / 100}s;--t:${Math.round(dur * 100) / 100}s"`;
    if (p.capa === 'lapiz' && t) {
      capas.lapiz.push(p.svg.replace('<path ', `<path${estilo(t.d, t.t)} `));
    } else if (p.centro && t) {
      capas[p.capa].push(p.svg);
      const m = `<path class="mt" pathLength="1" d="${p.centro.d}" stroke-width="${num(p.centro.ancho)}"${estilo(t.d, t.t)}/>`;
      (p.capa === 'tinta' ? mascaraTinta : mascaraColor).push(m);
    } else if (p.capa === 'planos' || p.capa === 'encima') {
      capas[p.capa].push(p.svg.replace('<path ', `<path style="--d:${Math.round((espera + total * 0.05 * nPlano++) * 100) / 100}s" `));
    } else {
      capas[p.capa].push(p.svg.replace('<text ', `<text style="--d:${Math.round((espera + total * 0.85) * 100) / 100}s" `));
    }
  }

  const id = (dibujo.id + (opciones.sufijo ? `-${opciones.sufijo}` : '')).replace(/[^a-z0-9-]/gi, '-');
  const [dx, dy] = dibujo.desregistro ?? [0.9, -0.7];
  const [cx, cy, cw, ch] = dibujo.caja ?? [0, 0, dibujo.ancho, dibujo.alto];
  const caja = `x="${cx}" y="${cy}" width="${cw}" height="${ch}"`;
  const etiquetas = opciones.decorativo
    ? ' aria-hidden="true" focusable="false"'
    : ` role="img" aria-labelledby="t-${id} d-${id}"`;
  const textos = opciones.decorativo ? '' : `<title id="t-${id}">${escapar(enLengua(dibujo.titulo, lengua))}</title><desc id="d-${id}">${escapar(enLengua(dibujo.descripcion, lengua))}</desc>`;
  const mascara = (nombre: string, trazos: string[]) =>
    trazos.length ? `<mask id="${nombre}" maskUnits="userSpaceOnUse" ${caja}><g fill="none" stroke="#fff" stroke-linecap="round" stroke-linejoin="round">${trazos.join('')}</g></mask>` : '';
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" class="dibujo${opciones.clase ? ` ${opciones.clase}` : ''}" viewBox="${cx} ${cy} ${cw} ${ch}" width="${cw}" height="${ch}"${etiquetas} data-dibujo="${id}">`,
    textos,
    `<defs>${mascara(`mt-${id}`, mascaraTinta)}${mascara(`mc-${id}`, mascaraColor)}</defs>`,
    capas.lapiz.length ? `<g class="c-la" fill="none" stroke="var(--d-lapiz)" stroke-linecap="round">${capas.lapiz.join('')}</g>` : '',
    capas.planos.length ? `<g class="c-pl">${capas.planos.join('')}</g>` : '',
    capas.tinta.length ? `<g class="c-ti" mask="url(#mt-${id})">${capas.tinta.join('')}</g>` : '',
    capas.color.length
      ? `<g class="c-co" transform="translate(${num(dx)} ${num(dy)})"${mascaraColor.length ? ` mask="url(#mc-${id})"` : ''}>${capas.color.join('')}</g>`
      : '',
    capas.encima.length ? `<g class="c-en" transform="translate(${num(dx)} ${num(dy)})">${capas.encima.join('')}</g>` : '',
    capas.notas.length ? `<g class="c-no">${capas.notas.join('')}</g>` : '',
    '</svg>',
  ].join('');
}
