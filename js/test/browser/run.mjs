// Browser tests in a real Chromium (headless, muted): the whole conformance suite with
// the WebAssembly engine on the main thread, and in a Web Worker the remote reading over
// HTTP Range requests (with byte counts), OPFS storage, lazy Blob reading and a legacy
// gzip file by URL.
//
//   npm run build && node test/browser/run.mjs [large.spdf]
//
// Writes test/browser/out/results.json and test/browser/out/conformance-browser.json.
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { startServer } from './server.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const jsDir = fileURLToPath(new URL('../../', import.meta.url));
const confDir = fileURLToPath(new URL('../../../conformance/', import.meta.url));
const outDir = `${here}out/`;
await mkdir(outDir, { recursive: true });

let large = process.argv[2] ?? `${outDir}large.spdf`;
if (!existsSync(large)) {
  console.error(`building ${large}…`);
  execFileSync(process.execPath, [`${here}make-large.mjs`, large, ...(process.env.SPDF_LARGE_TEXT ? [process.env.SPDF_LARGE_TEXT] : [])], { stdio: 'inherit' });
}

const { server, port, counters } = await startServer({ roots: { '/js/': jsDir, '/conformance/': confDir }, extra: { '/large.spdf': large } });
const browser = await chromium.launch({ headless: true, args: ['--mute-audio'] });
let exitCode = 0;
try {
  const page = await (await browser.newContext()).newPage();
  const logs = [];
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  await page.goto(`http://127.0.0.1:${port}/js/test/browser/page.html`);
  await page.waitForFunction(() => document.getElementById('status')?.textContent === 'ready', null, { timeout: 60_000 });
  const results = await page.evaluate((u) => window.runAll(u), '/large.spdf');
  results.server = Object.fromEntries(counters);
  results.chromium = browser.version();
  await writeFile(`${outDir}results.json`, JSON.stringify(results, null, 2));
  await writeFile(`${outDir}conformance-browser.json`, JSON.stringify(results.conformance, null, 2));

  const c = results.conformance;
  console.log(`Chromium ${results.chromium}: conformance ${c.passed.length} passed, ${c.failed.length} failed`);
  for (const f of c.failed) console.log(`  ${f.id}: ${f.reason}`);
  const w = results.worker;
  const problems = [];
  if (c.failed.length) problems.push('conformance failures');
  for (const [k, v] of Object.entries(w)) if (v?.error) problems.push(`worker ${k}: ${v.error}`);
  if (!w.opfs?.usesOpfs) problems.push('OPFS storage was not used in the worker');
  if (!w.opfs?.copyValid) problems.push('the copy written through OPFS is not valid');
  if (!w.blob?.lazy) problems.push('openBlob did not read lazily in the worker');
  if (w.legacyRemote?.version !== '4.1') problems.push('legacy file by URL');
  const lexical = w.measure?.steps?.['lexical: molinos de viento'];
  if (w.measure && !(lexical && lexical.bytes < w.measure.size / 20)) problems.push(`a lexical search downloaded ${lexical?.bytes} of ${w.measure.size} bytes`);
  if (w.measure?.steps) {
    const mb = (n) => `${(n / 1024 / 1024).toFixed(2)} MiB`;
    const kb = (n) => `${(n / 1024).toFixed(0)} KiB`;
    console.log(`remote file ${mb(w.measure.size)}; each line opens it afresh (bytes include opening):`);
    for (const [k, v] of Object.entries(w.measure.steps)) console.log(`  ${k}: ${v.bytes >= 1024 * 1024 ? mb(v.bytes) : kb(v.bytes)} in ${v.requests} requests (${(100 * v.bytes / w.measure.size).toFixed(2)} %), ${v.ms} ms`);
    console.log(`  main thread (sync XHR): open ${kb(results.remoteMain.opened.bytesFetched)}, search ${kb(results.remoteMain.search.bytes)}`);
  }
  if (problems.length) {
    exitCode = 1;
    console.log(`PROBLEMS:\n  ${problems.join('\n  ')}`);
    console.log(logs.slice(-30).join('\n'));
  }
} finally {
  await browser.close();
  server.close();
}
process.exit(exitCode);
