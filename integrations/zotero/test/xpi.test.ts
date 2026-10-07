/**
 * The built plugin: the .xpi unzips, its manifest is what Zotero 7 and 8 need, and its
 * `bootstrap.js` runs (startup, menus, import, citation, shutdown) in a `vm` context
 * that has only the globals Zotero's plugin sandbox provides
 * (`chrome/content/zotero/xpcom/plugins.js`): no `window`, no `console`, no
 * `DecompressionStream`. A separate realm also catches typed arrays that cross from the
 * host APIs without being copied, as they would cross compartments in Firefox.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
// @ts-expect-error: plain JS helper shared with the build script
import { unzip } from '../scripts/zip.mjs';
import { EN, EN_SHA, LEGACY_41, ROOT, tempDir } from './helpers/env.js';
import { fakeGlobals, fakeWindow } from './helpers/fake-globals.js';
import { fakeZotero } from './helpers/fake-zotero.js';

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string };
const XPI = join(ROOT, 'dist', `spdf-zotero-${pkg.version}.xpi`);
let files: Map<string, Uint8Array>;
const text = (name: string) => new TextDecoder().decode(files.get(name));

beforeAll(() => {
  if (!existsSync(XPI)) execFileSync(process.execPath, [join(ROOT, 'scripts', 'build.mjs')], { cwd: ROOT, stdio: 'ignore' });
  files = unzip(readFileSync(XPI));
});

describe('the .xpi', () => {
  it('holds the bootstrap script, the manifest and both locales', () => {
    expect([...files.keys()].sort()).toEqual([
      'LICENSE-APACHE',
      'LICENSE-MIT',
      'bootstrap.js',
      'locale/en-US/spdf-zotero.ftl',
      'locale/es-ES/spdf-zotero.ftl',
      'manifest.json',
    ]);
    expect(text('locale/es-ES/spdf-zotero.ftl')).toBe(readFileSync(join(ROOT, 'addon/locale/es-ES/spdf-zotero.ftl'), 'utf8'));
  });

  it('declares Zotero 7 and 8 in its manifest', () => {
    const m = JSON.parse(text('manifest.json'));
    expect(m.manifest_version).toBe(2);
    expect(m.version).toBe(pkg.version);
    expect(m.name).toBe('SPDF for Zotero');
    expect(m.applications.zotero.id).toBe('spdf@joseluissaorin.com');
    expect(m.applications.zotero.strict_min_version).toBe('6.999');
    expect(m.applications.zotero.strict_max_version).toBe('8.*');
    if (m.applications.zotero.update_url !== undefined) expect(m.applications.zotero.update_url).toMatch(/^https:\/\//);
    expect(m.applications.gecko).toBeUndefined();
  });

  it('has an ASCII bootstrap.js that defines the hooks Zotero calls', () => {
    const js = text('bootstrap.js');
    expect(/[^\x00-\x7f]/.test(js)).toBe(false);
    const ctx = vm.createContext({ TextEncoder, TextDecoder, URL, crypto });
    vm.runInContext(js, ctx, { filename: 'bootstrap.js' });
    for (const hook of ['install', 'startup', 'shutdown', 'uninstall', 'onMainWindowLoad', 'onMainWindowUnload']) expect(typeof ctx[hook], hook).toBe('function');
    expect(typeof ctx.SpdfZotero.createPlugin).toBe('function');
    expect(ctx.SpdfZotero.VERSION).toBe(pkg.version);
  });
});

describe('bootstrap.js in a Zotero-like sandbox', () => {
  function sandbox(script: Parameters<typeof fakeGlobals>[2]) {
    const tmp = tempDir();
    const z = fakeZotero({ locale: 'en-US' });
    const win = fakeWindow(z.pane, true);
    Object.assign(z.Z, {
      getMainWindow: () => win,
      getMainWindows: () => [win],
      getTempDirectory: () => ({ path: join(tmp, 'zotero-tmp') }),
      initializationPromise: Promise.resolve(),
    });
    const g = fakeGlobals(z.Z as never, join(tmp, 'zotero-tmp'), script);
    // What plugins.js puts in the sandbox (the browser-only ones are not used by the plugin).
    const ctx = vm.createContext({
      ...g.globals,
      atob,
      btoa,
      Blob,
      crypto,
      fetch,
      File,
      TextDecoder,
      TextEncoder,
      URL,
      URLSearchParams,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      APP_STARTUP: 1,
      APP_SHUTDOWN: 2,
      ADDON_ENABLE: 3,
      ADDON_DISABLE: 4,
    });
    vm.runInContext(text('bootstrap.js'), ctx, { filename: 'bootstrap.js' });
    return { ctx, win, z, g, tmp };
  }

  it('starts, adds the menus, imports, cites and shuts down', async () => {
    const { ctx, win, z, g, tmp } = sandbox({ files: [EN], prompts: ['p=4'] });
    const data = { id: 'spdf@joseluissaorin.com', version: pkg.version, rootURI: 'jar:file:///tmp/spdf-zotero.xpi!/' };
    await ctx.startup(data, 1);
    expect(win.itemMenu.children).toHaveLength(4);
    expect(win.toolsMenu.children).toHaveLength(1);

    win.toolsMenu.children[0]!.dispatch('command');
    await vi.waitFor(() => expect([z.log.imports.length, g.log.alerts, z.log.errors.map(String)]).toEqual([1, [], []]));
    const item = z.items.get(z.log.selected[0]!)!;
    expect(item.getField('extra')).toBe(`SPDF: sha256-${EN_SHA}`);

    z.pane.selected = [item];
    win.itemMenu.children.find((c) => c.id === 'spdf-zotero-item-cite')!.dispatch('command');
    await vi.waitFor(() => expect(z.log.clipboard).toHaveLength(1));
    expect(z.log.clipboard[0]).toBe(`(Saorín Ferrer, 2026, p. [3])\nspdf:sha256-${EN_SHA}#p=4&f=3`);
    expect(g.log.alerts).toEqual([]);

    ctx.shutdown(data, 4);
    expect(win.itemMenu.children).toHaveLength(0);
    expect(g.sqlite.openCount()).toBe(0);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('imports a gzip-wrapped legacy file (DecompressionStream from the main window)', async () => {
    const { ctx, win, z, g, tmp } = sandbox({ files: [LEGACY_41], prompts: ['x'] });
    expect(vm.runInContext('typeof DecompressionStream', ctx)).toBe('undefined');
    await ctx.startup({ id: 'spdf@joseluissaorin.com', version: pkg.version, rootURI: '' }, 1);
    win.toolsMenu.children[0]!.dispatch('command');
    await vi.waitFor(() => expect(z.log.imports).toHaveLength(1));
    expect(g.log.alerts).toEqual([]);
    const item = z.items.get(z.log.selected[0]!)!;
    z.pane.selected = [item];
    win.itemMenu.children.find((c) => c.id === 'spdf-zotero-item-cite')!.dispatch('command');
    await vi.waitFor(() => expect(z.log.clipboard).toHaveLength(1));
    expect(z.log.clipboard[0]).toMatch(/^\(Garcilaso de la Vega, 1580, p\. \[x\]\)\nspdf:sha256-[0-9a-f]{64}#p=3&f=x$/);
    ctx.shutdown({}, 4);
    rmSync(tmp, { recursive: true, force: true });
  });
});
