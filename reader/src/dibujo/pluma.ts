/**
 * La mano. Las formas de cada dibujo están escritas a mano, punto a punto, en
 * `dibujos/`; este módulo no inventa ninguna. Solo hace lo que haría una pluma
 * sobre esos puntos: pasar por ellos con una curva suelta, temblar un poco,
 * apretar al empezar, aflojar al final y dejar que la tinta se encharque donde
 * la mano se detiene.
 */
import { entre, generador } from './azar';

export type Punto = readonly [number, number];

/* ------------------------------------------------------------------ */
/* Geometría básica                                                    */
/* ------------------------------------------------------------------ */

const dist = (a: Punto, b: Punto) => Math.hypot(b[0] - a[0], b[1] - a[1]);

/**
 * Curva de Catmull-Rom centrípeta que pasa por los puntos escritos a mano.
 * La centrípeta no hace bucles ni picos en las curvas cerradas: es la que más
 * se parece a una mano que sabe adónde va.
 */
export function curva(puntos: readonly Punto[], cerrada = false, paso = 3): Punto[] {
  if (puntos.length < 2) return puntos.slice();
  const p = cerrada ? [puntos[puntos.length - 1]!, ...puntos, puntos[0]!, puntos[1]!] : [puntos[0]!, ...puntos, puntos[puntos.length - 1]!];
  const fuera: Punto[] = [];
  for (let i = 1; i < p.length - 2; i++) {
    const p0 = p[i - 1]!, p1 = p[i]!, p2 = p[i + 1]!, p3 = p[i + 2]!;
    const t0 = 0;
    const t1 = t0 + Math.max(Math.sqrt(dist(p0, p1)), 1e-3);
    const t2 = t1 + Math.max(Math.sqrt(dist(p1, p2)), 1e-3);
    const t3 = t2 + Math.max(Math.sqrt(dist(p2, p3)), 1e-3);
    const n = Math.max(2, Math.ceil(dist(p1, p2) / paso));
    for (let k = 0; k < n; k++) {
      const t = t1 + ((t2 - t1) * k) / n;
      const a1 = mezcla(p0, p1, t0, t1, t), a2 = mezcla(p1, p2, t1, t2, t), a3 = mezcla(p2, p3, t2, t3, t);
      const b1 = mezcla(a1, a2, t0, t2, t), b2 = mezcla(a2, a3, t1, t3, t);
      fuera.push(mezcla(b1, b2, t1, t2, t));
    }
  }
  fuera.push(cerrada ? puntos[0]! : puntos[puntos.length - 1]!);
  return fuera;
}

function mezcla(a: Punto, b: Punto, ta: number, tb: number, t: number): Punto {
  const d = tb - ta;
  if (Math.abs(d) < 1e-9) return a;
  const u = (t - ta) / d;
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
}

/** Línea quebrada (para lo que se traza con regla): se remuestrea para que también tiemble. */
export function quebrada(puntos: readonly Punto[], cerrada = false, paso = 4): Punto[] {
  const pts = cerrada ? [...puntos, puntos[0]!] : puntos.slice();
  const fuera: Punto[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!, b = pts[i + 1]!;
    const n = Math.max(1, Math.ceil(dist(a, b) / paso));
    for (let k = 0; k < n; k++) fuera.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  fuera.push(pts[pts.length - 1]!);
  return fuera;
}

function longitudes(poli: readonly Punto[]): number[] {
  const l = [0];
  for (let i = 1; i < poli.length; i++) l.push(l[i - 1]! + dist(poli[i - 1]!, poli[i]!));
  return l;
}

function normales(poli: readonly Punto[]): Punto[] {
  return poli.map((_, i) => {
    const a = poli[Math.max(0, i - 1)]!, b = poli[Math.min(poli.length - 1, i + 1)]!;
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    return [-dy / l, dx / l] as Punto;
  });
}

/* ------------------------------------------------------------------ */
/* El pulso                                                            */
/* ------------------------------------------------------------------ */

export interface Pulso {
  /** Amplitud del temblor, en unidades del dibujo. */
  temblor: number;
  /** Cuánto se pasa (o se queda corta) la línea en sus extremos. */
  desborde: number;
}

/**
 * Hace temblar una línea: un vaivén lento (el pulso del brazo) más uno rápido
 * y pequeño (el de los dedos), siempre perpendicular al trazo. Los extremos se
 * alargan o se acortan un poco: la mano nunca para exactamente donde quería.
 */
export function temblar(poli: readonly Punto[], semilla: number, pulso: Pulso, cerrada = false): Punto[] {
  const azar = generador(semilla);
  if (poli.length < 2) return poli.slice();
  const l = longitudes(poli);
  const total = l[l.length - 1]! || 1;
  const ondas = [
    { a: pulso.temblor, lam: entre(azar, 70, 160), fi: entre(azar, 0, 6.283) },
    { a: pulso.temblor * 0.45, lam: entre(azar, 22, 40), fi: entre(azar, 0, 6.283) },
    { a: pulso.temblor * 0.18, lam: entre(azar, 7, 12), fi: entre(azar, 0, 6.283) },
  ];
  const n = normales(poli);
  const fuera: Punto[] = poli.map((p, i) => {
    const s = l[i]!;
    let d = 0;
    for (const o of ondas) d += o.a * Math.sin((6.283 * s) / o.lam + o.fi);
    // En una curva cerrada el temblor se apaga hacia la costura para no abrir un hueco grande.
    if (cerrada) d *= Math.min(1, s / 12, (total - s) / 12) * 0.6 + 0.4;
    return [p[0] + n[i]![0] * d, p[1] + n[i]![1] * d];
  });
  if (!cerrada && pulso.desborde > 0 && fuera.length > 2) {
    const alarga = (a: Punto, b: Punto, cuanto: number): Punto => {
      const dx = a[0] - b[0], dy = a[1] - b[1];
      const m = Math.hypot(dx, dy) || 1;
      return [a[0] + (dx / m) * cuanto, a[1] + (dy / m) * cuanto];
    };
    const ini = entre(azar, -0.4, 1) * pulso.desborde;
    const fin = entre(azar, -0.3, 1) * pulso.desborde;
    if (ini > 0) fuera.unshift(alarga(fuera[0]!, fuera[1]!, ini));
    if (fin > 0) fuera.push(alarga(fuera[fuera.length - 1]!, fuera[fuera.length - 2]!, fin));
  }
  return fuera;
}

/* ------------------------------------------------------------------ */
/* La presión y el contorno                                            */
/* ------------------------------------------------------------------ */

/**
 * Cuánto aprieta la pluma a lo largo del trazo (t de 0 a 1): entra fina, carga
 * en el primer tercio, afloja al final y, justo donde se levanta, deja un
 * charquito de tinta.
 */
export function presion(t: number, fase: number, cerrada = false): number {
  const respiro = 1 + 0.14 * Math.sin(6.283 * (t * 1.7 + fase)) + 0.06 * Math.sin(6.283 * (t * 5.3 + fase * 3));
  if (cerrada) return Math.max(0.3, respiro * (1 + 0.35 * Math.exp(-((t - 0.02) ** 2) / 0.0004)));
  const entrada = t < 0.14 ? 0.32 + 0.68 * Math.sin((t / 0.14) * 1.5708) : 1;
  const salida = t > 0.78 ? 1 - 0.42 * ((t - 0.78) / 0.22) : 1;
  const charco = 0.55 * Math.exp(-((t - 0.985) ** 2) / 0.00012);
  return Math.max(0.22, entrada * salida * respiro + charco);
}

/**
 * El contorno relleno de un trazo de pluma: el lado izquierdo, la punta, el
 * lado derecho al revés y la cola. Devuelve los puntos del polígono.
 */
export function contorno(poli: readonly Punto[], grosor: number, fase: number, cerrada = false): Punto[] {
  if (poli.length < 2) return [];
  const l = longitudes(poli);
  const total = l[l.length - 1]! || 1;
  const n = normales(poli);
  const izq: Punto[] = [], der: Punto[] = [];
  for (let i = 0; i < poli.length; i++) {
    const w = (grosor / 2) * presion(l[i]! / total, fase, cerrada);
    const p = poli[i]!;
    izq.push([p[0] + n[i]![0] * w, p[1] + n[i]![1] * w]);
    der.push([p[0] - n[i]![0] * w, p[1] - n[i]![1] * w]);
  }
  if (cerrada) return [...izq, ...der.reverse()];
  // Puntas redondeadas: medio círculo con el ancho del extremo.
  const tapa = (centro: Punto, desde: Punto, hacia: Punto): Punto[] => {
    const r = dist(desde, hacia) / 2;
    const a0 = Math.atan2(desde[1] - centro[1], desde[0] - centro[0]);
    const pts: Punto[] = [];
    for (let k = 1; k < 5; k++) {
      const a = a0 - (Math.PI * k) / 5;
      pts.push([centro[0] + Math.cos(a) * r, centro[1] + Math.sin(a) * r]);
    }
    return pts;
  };
  const ultimo = poli.length - 1;
  return [
    ...izq,
    ...tapa(poli[ultimo]!, izq[ultimo]!, der[ultimo]!),
    ...der.slice().reverse(),
    ...tapa(poli[0]!, der[0]!, izq[0]!),
  ];
}

/* ------------------------------------------------------------------ */
/* Simplificar y escribir                                              */
/* ------------------------------------------------------------------ */

/** Ramer-Douglas-Peucker: quita los puntos que no se ven, para que el HTML pese poco. */
export function simplificar(pts: readonly Punto[], tolerancia: number): Punto[] {
  if (pts.length < 3) return pts.slice();
  const marca = new Uint8Array(pts.length);
  marca[0] = 1;
  marca[pts.length - 1] = 1;
  const pila: [number, number][] = [[0, pts.length - 1]];
  while (pila.length) {
    const [a, b] = pila.pop()!;
    const pa = pts[a]!, pb = pts[b]!;
    const dx = pb[0] - pa[0], dy = pb[1] - pa[1];
    const m = Math.hypot(dx, dy) || 1e-9;
    let peor = -1, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const p = pts[i]!;
      const d = Math.abs(dy * p[0] - dx * p[1] + pb[0] * pa[1] - pb[1] * pa[0]) / m;
      if (d > peor) { peor = d; idx = i; }
    }
    if (peor > tolerancia && idx > 0) {
      marca[idx] = 1;
      pila.push([a, idx], [idx, b]);
    }
  }
  return pts.filter((_, i) => marca[i]);
}

export const num = (n: number) => {
  const r = Math.round(n * 10) / 10;
  return Object.is(r, -0) ? '0' : String(r);
};

/** Polígono cerrado → «M x y L x y … Z». */
export function caminoCerrado(pts: readonly Punto[]): string {
  if (!pts.length) return '';
  return `M${num(pts[0]![0])} ${num(pts[0]![1])}L${pts.slice(1).map((p) => `${num(p[0])} ${num(p[1])}`).join(' ')}Z`;
}

/** Línea abierta → «M x y L x y …». */
export function caminoAbierto(pts: readonly Punto[]): string {
  if (!pts.length) return '';
  return `M${num(pts[0]![0])} ${num(pts[0]![1])}L${pts.slice(1).map((p) => `${num(p[0])} ${num(p[1])}`).join(' ')}`;
}

export function longitud(pts: readonly Punto[]): number {
  const l = longitudes(pts);
  return l[l.length - 1] ?? 0;
}

/* ------------------------------------------------------------------ */
/* Sombreado                                                           */
/* ------------------------------------------------------------------ */

/**
 * Las rayas de un sombreado dentro de una zona escrita a mano. La mano raya en
 * paralelo y se cansa: con `cobertura` < 1 se queda a medias, y las últimas
 * rayas salen más cortas, como cuando uno deja el lápiz sin terminar.
 */
export function rayas(zona: readonly Punto[], angulo: number, paso: number, cobertura: number, semilla: number): Punto[][] {
  const azar = generador(semilla);
  const a = (angulo * Math.PI) / 180;
  const ux = Math.cos(a), uy = Math.sin(a); // dirección de la raya
  const nx = -uy, ny = ux; // dirección en la que avanza el sombreado
  const proy = zona.map((p) => p[0] * nx + p[1] * ny);
  const min = Math.min(...proy), max = Math.max(...proy);
  const fuera: Punto[][] = [];
  const total = Math.floor((max - min) / paso);
  const hasta = Math.max(1, Math.round(total * cobertura));
  for (let k = 1; k <= hasta; k++) {
    const c = min + k * paso + entre(azar, -paso * 0.25, paso * 0.25);
    // Cortes de la recta {p·n = c} con los lados de la zona.
    const cortes: number[] = [];
    for (let i = 0; i < zona.length; i++) {
      const p = zona[i]!, q = zona[(i + 1) % zona.length]!;
      const dp = p[0] * nx + p[1] * ny - c, dq = q[0] * nx + q[1] * ny - c;
      if ((dp < 0) !== (dq < 0)) {
        const t = dp / (dp - dq);
        const x = p[0] + (q[0] - p[0]) * t, y = p[1] + (q[1] - p[1]) * t;
        cortes.push(x * ux + y * uy);
      }
    }
    cortes.sort((x, y) => x - y);
    const cansancio = cobertura < 1 && k > hasta * 0.7 ? 1 - ((k - hasta * 0.7) / (hasta * 0.3)) * 0.6 : 1;
    for (let j = 0; j + 1 < cortes.length; j += 2) {
      let s0 = cortes[j]!, s1 = cortes[j + 1]!;
      const largo = s1 - s0;
      s0 += largo * entre(azar, 0.02, 0.12);
      s1 -= largo * (entre(azar, 0, 0.1) + (1 - cansancio));
      if (s1 - s0 < 2) continue;
      fuera.push([
        [s0 * ux + c * nx, s0 * uy + c * ny],
        [s1 * ux + c * nx, s1 * uy + c * ny],
      ]);
    }
  }
  return fuera;
}
