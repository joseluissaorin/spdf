/** El emblema del lector: la manícula, dibujada a mano (ver dibujo/dibujos/manicula.ts). */
import { Boceto } from '../dibujo/BocetoReact';
import { useIdioma } from '../i18n';

export function Emblema() {
  const { lengua } = useIdioma();
  return <Boceto carga={() => import('../dibujo/dibujos/manicula').then((m) => m.emblema)} caja={[96, 52]} nombre="emblema" decorativo dibujar="ya" lengua={lengua} />;
}
