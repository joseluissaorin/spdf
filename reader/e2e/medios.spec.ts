/** Audio y vídeo con transcripción, resaltado palabra a palabra y saltos al segundo. Sin sonido (--mute-audio). */
import { test, expect } from '@playwright/test';
import { abrirLimpio, importarYAbrir, dato, hayDato, CAPTURAS } from './ayudas';
import { resolve } from 'node:path';

for (const [fichero, tipo] of [['quijote-audio.spdf', 'audio'], ['quijote-video.spdf', 'video']] as const) {
  test(`${tipo}: saltar a una palabra la resalta y mueve el medio`, async ({ page }) => {
    test.skip(!hayDato(fichero), 'sin fichero de prueba (hace falta `say` y ffmpeg)');
    await abrirLimpio(page);
    await importarYAbrir(page, dato(fichero));
    await expect(page.locator(`.medio ${tipo}`)).toBeAttached();
    await expect(page.locator('.turno')).toHaveCount(3);
    // El medio carga de verdad (metadatos con su duración).
    await expect.poll(() => page.locator(`.medio ${tipo}`).evaluate((m: HTMLMediaElement) => m.readyState)).toBeGreaterThan(0);
    await page.locator('.turno').nth(1).locator('.palabra', { hasText: 'enfrascó' }).click();
    await expect(page.locator('.palabra.ahora')).toHaveText('enfrascó');
    await expect(page.locator('.turno.activo')).toHaveCount(1);
    const t = await page.locator(`.medio ${tipo}`).evaluate((m: HTMLMediaElement) => { m.pause(); return m.currentTime; });
    expect(t).toBeGreaterThan(20);
    await expect(page.locator('.medio .reloj')).not.toHaveText(/^0:00/);
    // La hora del turno salta al segundo.
    await page.locator('.turno').nth(2).locator('.tiempo').click();
    await page.locator(`.medio ${tipo}`).evaluate((m: HTMLMediaElement) => m.pause());
    await expect(page.locator('.turno').nth(2)).toHaveClass(/activo/);
    await page.screenshot({ path: resolve(CAPTURAS, `web-${tipo}.png`) });
  });
}

test('audio 5.0 de conformidad (Apolo 11): la transcripción se lee con sus horas', async ({ page }) => {
  await abrirLimpio(page);
  await importarYAbrir(page, resolve(import.meta.dirname, '../../conformance/files/apolo11.spdf'));
  await expect(page.locator('.turno').first()).toBeVisible();
  await expect(page.locator('.turno .tiempo').first()).toHaveText(/\d:\d\d/);
});
