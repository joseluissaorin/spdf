/**
 * Pruebas de extremo a extremo del lector web, en Chromium sin cabeza con
 * WebGPU y sin sonido (--mute-audio: nunca suena nada por los altavoces).
 * Sirven la build de producción (`npm run build:web`) con `vite preview`.
 */
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173/',
    trace: 'retain-on-failure',
    viewport: { width: 1440, height: 900 },
    locale: 'es-ES',
    permissions: ['clipboard-read', 'clipboard-write'],
    acceptDownloads: true,
    launchOptions: {
      args: ['--mute-audio', '--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=metal', '--autoplay-policy=no-user-gesture-required'],
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, locale: 'es-ES', permissions: ['clipboard-read', 'clipboard-write'] } }],
  webServer: {
    command: 'npx vite preview --mode web --port 4173 --strictPort',
    port: 4173,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
