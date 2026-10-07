/**
 * Una sola interfaz, dos destinos:
 *   --mode web    → dist-web/  (100 % en el cliente, PWA, base relativa para servirla bajo /reader/)
 *   --mode tauri  → dist-tauri/ (la misma interfaz dentro de Tauri; sin service worker)
 *
 * Las bibliotecas hermanas (`js/` → spdf-format, `models/web` → spdf-infer-web) se usan
 * por ruta. Mientras no existan, se usa un simulacro con su misma API
 * (src/nucleo/simulacros/), para que el lector se pueda construir y probar ya.
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const aqui = import.meta.dirname;
const ruta = (p: string) => resolve(aqui, p);

/** Entrada real de una biblioteca hermana si ya está compilada; si no, el simulacro. */
function hermana(nombre: string, candidatas: string[], simulacro: string): string {
  if (process.env.SPDF_SIMULACROS === '1') return ruta(simulacro);
  for (const c of candidatas) if (existsSync(ruta(c))) return ruta(c);
  console.warn(`[lector] ${nombre}: no está compilada todavía; uso el simulacro ${simulacro}`);
  return ruta(simulacro);
}

export default defineConfig(({ mode }) => {
  const web = mode !== 'tauri';
  return {
    base: './',
    clearScreen: false,
    plugins: [
      react(),
      web &&
        VitePWA({
          registerType: 'prompt',
          injectRegister: false,
          manifest: false, // public/manifest.webmanifest, escrito a mano
          workbox: {
            globPatterns: ['**/*.{js,css,html,woff2,svg,png,wasm,webmanifest,xml,json}'],
            maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
            navigateFallback: 'index.html',
          },
        }),
    ],
    resolve: {
      alias: {
        'spdf-format/browser': hermana('spdf-format', ['../js/dist/entry/browser.js'], 'src/nucleo/simulacros/spdf-format.ts'),
        'spdf-infer-web': hermana('spdf-infer-web', ['../models/web/dist/index.js', '../models/web/dist/index.mjs'], 'src/nucleo/simulacros/spdf-infer-web.ts'),
      },
    },
    define: {
      __DESTINO__: JSON.stringify(web ? 'web' : 'tauri'),
      __VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.1.0'),
    },
    optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] },
    worker: { format: 'es' },
    server: {
      port: 5173,
      strictPort: true,
      host: process.env.TAURI_DEV_HOST || false,
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
      },
    },
    preview: {
      port: 4173,
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
      },
    },
    build: {
      outDir: web ? 'dist-web' : 'dist-tauri',
      emptyOutDir: true,
      target: 'es2022',
      sourcemap: false,
      chunkSizeWarningLimit: 1500,
    },
  };
});
