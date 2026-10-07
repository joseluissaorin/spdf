/**
 * Arranque: elige el núcleo según dónde corre (Tauri o navegador) y monta la
 * interfaz. Se mide el arranque para RENDIMIENTO.md (performance.mark).
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './dibujo/dibujos.css';
import './estilos/lector.css';
import { App } from './app/App';
import { ProveedorApp } from './app/estado';
import type { Nucleo } from './nucleo/nucleo';

performance.mark('spdf:inicio');

async function crearNucleo(): Promise<Nucleo> {
  const pruebas = new URLSearchParams(location.search).has('pruebas') || import.meta.env.DEV;
  if ('__TAURI_INTERNALS__' in window) {
    const { NucleoTauri } = await import('./nucleo/tauri/nucleo-tauri');
    return new NucleoTauri({ pruebas });
  }
  const { NucleoWeb } = await import('./nucleo/web/nucleo-web');
  return new NucleoWeb({ pruebas });
}

const raiz = createRoot(document.getElementById('raiz')!);
crearNucleo()
  .then(async (nucleo) => {
    await nucleo.iniciar();
    performance.mark('spdf:nucleo');
    (window as unknown as { __spdf: Nucleo }).__spdf = nucleo; // para las pruebas de extremo a extremo
    raiz.render(
      <StrictMode>
        <ProveedorApp nucleo={nucleo}>
          <App />
        </ProveedorApp>
      </StrictMode>,
    );
  })
  .catch((e: unknown) => {
    console.error(e);
    document.getElementById('raiz')!.innerHTML = `<p style="padding:2rem;font:18px Georgia,serif">No se pudo arrancar el lector: ${String(e instanceof Error ? e.message : e).replace(/</g, '&lt;')}</p>`;
  });
