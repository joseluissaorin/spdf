/**
 * Iconos de línea, dibujados a mano en una retícula de 24 con trazo de 1,6:
 * los mismos ángulos y remates que la tinta de los dibujos, sin relleno.
 * Todos son decorativos (aria-hidden); el nombre accesible lo lleva el botón.
 */
import type { SVGProps } from 'react';

const P = (p: SVGProps<SVGSVGElement>) => ({
  viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6,
  strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true, focusable: false, ...p,
});

export const Atras = (p: SVGProps<SVGSVGElement>) => <svg {...P(p)}><path d="M15 5l-7 7 7 7" /></svg>;
export const Izq = (p: SVGProps<SVGSVGElement>) => <svg {...P(p)}><path d="M14.5 6l-6 6 6 6" /></svg>;
export const Der = (p: SVGProps<SVGSVGElement>) => <svg {...P(p)}><path d="M9.5 6l6 6-6 6" /></svg>;
export const Lupa = (p: SVGProps<SVGSVGElement>) => <svg {...P(p)}><circle cx="10.5" cy="10.5" r="6" /><path d="M15 15l5.5 5.5" /></svg>;
export const Cerrar = (p: SVGProps<SVGSVGElement>) => <svg {...P(p)}><path d="M6 6l12 12M18 6L6 18" /></svg>;
export const Mas = (p: SVGProps<SVGSVGElement>) => <svg {...P(p)}><path d="M12 5v14M5 12h14" /></svg>;
export const Ajustes = (p: SVGProps<SVGSVGElement>) => <svg {...P(p)}><path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" /></svg>;
export const Comillas = (p: SVGProps<SVGSVGElement>) => <svg {...P(p)}><path d="M10 7l-4 5 4 5M17 7l-4 5 4 5" /></svg>;
export const Ficha = (p: SVGProps<SVGSVGElement>) => <svg {...P(p)}><rect x="4" y="5" width="16" height="14" rx="1" /><path d="M8 9h8M8 12.5h8M8 16h5" /><circle cx="12" cy="5" r="1" /></svg>;
export const Pregunta = (p: SVGProps<SVGSVGElement>) => <svg {...P(p)}><path d="M5 5h14v10h-7l-4 4v-4H5z" /><path d="M10.2 8.6a1.9 1.9 0 113 1.6c-.7.4-1.2.8-1.2 1.6" /><path d="M12 13.4v.1" /></svg>;
export const Vectores = (p: SVGProps<SVGSVGElement>) => <svg {...P(p)}><circle cx="6" cy="17" r="1.6" /><circle cx="17" cy="6" r="1.6" /><circle cx="18" cy="16" r="1.6" /><path d="M7.4 16l9-9M7.6 17h8.8" strokeDasharray="1.5 2.5" /></svg>;
export const Lapiz = (p: SVGProps<SVGSVGElement>) => <svg {...P(p)}><path d="M4 20l1-4L16 5l3 3L8 19z" /><path d="M14 7l3 3" /></svg>;
export const Exportar = (p: SVGProps<SVGSVGElement>) => <svg {...P(p)}><path d="M12 4v11M7.5 8.5L12 4l4.5 4.5" /><path d="M5 14v5h14v-5" /></svg>;
export const Importar = (p: SVGProps<SVGSVGElement>) => <svg {...P(p)}><path d="M12 4v11M7.5 10.5L12 15l4.5-4.5" /><path d="M5 14v5h14v-5" /></svg>;
export const Papelera = (p: SVGProps<SVGSVGElement>) => <svg {...P(p)}><path d="M5 7h14M9 7V5h6v2M7 7l1 12h8l1-12" /></svg>;
export const Facsimil = (p: SVGProps<SVGSVGElement>) => <svg {...P(p)}><rect x="5" y="3.5" width="14" height="17" rx="0.5" /><path d="M8 8h8M8 11h8M8 14h5" strokeDasharray="2 1.5" /></svg>;
export const Texto = (p: SVGProps<SVGSVGElement>) => <svg {...P(p)}><path d="M5 6h14M5 10h14M5 14h14M5 18h9" /></svg>;
export const Ambos = (p: SVGProps<SVGSVGElement>) => <svg {...P(p)}><rect x="3" y="4" width="8" height="16" rx="0.5" /><path d="M14 7h7M14 11h7M14 15h7M14 19h4" /></svg>;
export const Reproducir = (p: SVGProps<SVGSVGElement>) => <svg {...P(p)}><path d="M8 5.5v13l10-6.5z" /></svg>;
export const Pausa = (p: SVGProps<SVGSVGElement>) => <svg {...P(p)}><path d="M8.5 5.5v13M15.5 5.5v13" /></svg>;
export const Figura = (p: SVGProps<SVGSVGElement>) => <svg {...P(p)}><rect x="4" y="5" width="16" height="14" rx="0.5" /><path d="M6 17l4.5-5.5 3 3.5 2-2 3 4" /><circle cx="15.5" cy="9" r="1.4" /></svg>;
export const Indice = (p: SVGProps<SVGSVGElement>) => <svg {...P(p)}><path d="M9 6h11M9 12h11M9 18h11" /><path d="M4.5 6h.5M4.5 12h.5M4.5 18h.5" /></svg>;
export const Notas = (p: SVGProps<SVGSVGElement>) => <svg {...P(p)}><path d="M5 4h10l4 4v12H5z" /><path d="M15 4v4h4M8 12h8M8 15.5h6" /></svg>;
export const Copiar = (p: SVGProps<SVGSVGElement>) => <svg {...P(p)}><rect x="8" y="8" width="11" height="12" rx="0.5" /><path d="M5 16V4h11" /></svg>;
export const Hecho = (p: SVGProps<SVGSVGElement>) => <svg {...P(p)}><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>;
export const Luna = (p: SVGProps<SVGSVGElement>) => <svg {...P(p)}><path d="M19 14.5A7.5 7.5 0 019.5 5a7.5 7.5 0 109.5 9.5z" /></svg>;

/** La manícula pequeña de los botones de citar: el índice que señala. */
export const Manicula = (p: SVGProps<SVGSVGElement>) => (
  <svg {...P({ viewBox: '0 0 40 24', ...p })}>
    <path d="M2 7.5h4.5M2 17h5" />
    <path d="M7 5.5c3-1 6-1 8.5.6h17.2c1.6 0 2.4 1.1 2.4 2.2s-.8 2.3-2.4 2.3H20" />
    <path d="M20 10.6h-2.6c1.4 0 2.3.9 2.3 1.9s-.9 1.9-2.3 1.9h-1.7c1.2 0 2 .8 2 1.8s-.8 1.8-2 1.8H9.8c-1.2 0-2-.3-2.8-.9V5.5" />
  </svg>
);
