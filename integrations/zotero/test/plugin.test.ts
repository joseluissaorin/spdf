/**
 * The plugin lifecycle (startup, windows, menus, shutdown) and the real Mozilla-side
 * host code, driven through fake bootstrap globals and a fake DOM: Zotero 7 (menus in
 * the DOM) and Zotero 8 (`Zotero.MenuManager`).
 */

import { afterAll, describe, expect, it, vi } from 'vitest';
import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createPlugin } from '../src/plugin.js';
import { MENU_IDS } from '../src/menus.js';
import { toCslJson } from 'spdf-format/core';
import { EN, EN_SHA, LEGACY_FILES, ROTO, reference, tempDir } from './helpers/env.js';
import { fakeGlobals, fakeWindow, type FakeElement } from './helpers/fake-globals.js';
import { fakeZotero } from './helpers/fake-zotero.js';

const root = tempDir();
afterAll(() => rmSync(root, { recursive: true, force: true }));

const DATA = { id: 'spdf@joseluissaorin.com', version: '0.1.0', rootURI: 'jar:file:///tmp/spdf-zotero.xpi!/' };
const ADDON_DISABLE = 4;
const APP_SHUTDOWN = 2;

let n = 0;
/** A fake Zotero with one main window, plus the bootstrap globals. */
export function world(script: Parameters<typeof fakeGlobals>[2] = {}, options: { locale?: string; menuManager?: boolean } = {}) {
  const z = fakeZotero({ locale: options.locale ?? 'en-US', libraryID: 1 });
  const win = fakeWindow(z.pane, true);
  const zoteroTmp = join(root, `zotero-tmp-${n++}`);
  const notices: string[][] = [];
  class ProgressWindow {
    private lines: string[] = [];
    changeHeadline(h: string) {
      this.lines.unshift(h);
    }
    addDescription(d: string) {
      this.lines.push(d);
    }
    show() {
      notices.push(this.lines);
    }
    startCloseTimer() {}
  }
  const menus = { registered: [] as Array<Record<string, any>>, unregistered: [] as string[] };
  Object.assign(z.Z, {
    getMainWindow: () => win,
    getMainWindows: () => [win],
    getTempDirectory: () => ({ path: zoteroTmp }),
    ProgressWindow,
    initializationPromise: Promise.resolve(),
  });
  if (options.menuManager) {
    Object.assign(z.Z, {
      MenuManager: {
        registerMenu(o: Record<string, any>) {
          menus.registered.push(o);
          return o.menuID;
        },
        unregisterMenu(id: string) {
          menus.unregistered.push(id);
          return true;
        },
      },
    });
  }
  const g = fakeGlobals(z.Z as never, zoteroTmp, script);
  return { ...z, win, notices, menus, zoteroTmp, globals: g.globals, sqlite: g.sqlite, prompts: g.log };
}

const el = (w: ReturnType<typeof world>, id: string) => w.win.document.getElementById(id) as FakeElement;

describe('Zotero 7: menus in the DOM', () => {
  it('adds the menus, shows item entries only when they apply, and runs the commands', async () => {
    const w = world({ files: [EN], prompts: ['[3]'] });
    const plugin = createPlugin(w.globals as never);
    await plugin.startup(DATA, 1);

    expect(el(w, MENU_IDS.toolsImport).attributes['data-l10n-id']).toBe('spdf-menu-import');
    expect(w.win.toolsMenu.children.map((c) => c.id)).toEqual([MENU_IDS.toolsImport]);
    expect(w.win.itemMenu.children.map((c) => c.id)).toEqual([MENU_IDS.itemSeparator, MENU_IDS.itemImport, MENU_IDS.itemAttach, MENU_IDS.itemCite]);
    expect(w.win.itemMenu.children.slice(1).map((c) => c.attributes['data-l10n-id'])).toEqual(['spdf-menu-import', 'spdf-menu-attach', 'spdf-menu-cite']);
    expect(w.win.document.querySelector('link[href="spdf-zotero.ftl"]')).not.toBeNull();

    // nothing selected: neither Attach nor Copy citation
    w.pane.selected = [];
    w.win.itemMenu.dispatch('popupshowing');
    expect([el(w, MENU_IDS.itemAttach).hidden, el(w, MENU_IDS.itemCite).hidden]).toEqual([true, true]);
    // a submenu's popupshowing bubbling up is ignored
    w.win.itemMenu.dispatch('popupshowing', {});

    // Tools → Import SPDF as Item…
    el(w, MENU_IDS.toolsImport).dispatch('command');
    await vi.waitFor(() => expect(w.log.imports).toHaveLength(1));
    expect(w.prompts.filePickers).toEqual([{ title: 'Import SPDF as Item', filters: ['SPDF (*.spdf)|*.spdf', 'mask:1'] }]);
    const item = w.items.get(w.log.selected[0]!)!;
    expect(item.getField('extra')).toBe(`SPDF: sha256-${EN_SHA}`);
    await vi.waitFor(() => expect(w.notices).toEqual([['SPDF imported', 'SPDF in five pages']]));

    // the new item: Attach and Copy citation both apply
    w.pane.selected = [item];
    w.win.itemMenu.dispatch('popupshowing');
    expect([el(w, MENU_IDS.itemAttach).hidden, el(w, MENU_IDS.itemCite).hidden]).toEqual([false, false]);

    // Copy citation with folio… asks with Services.prompt and copies
    el(w, MENU_IDS.itemCite).dispatch('command');
    await vi.waitFor(() => expect(w.log.clipboard).toHaveLength(1));
    expect(w.log.clipboard[0]).toBe(`(Saorín Ferrer, 2026, p. [3])\nspdf:sha256-${EN_SHA}#p=4&f=3`);
    expect(w.prompts.prompts[0]).toMatch(/^Printed folio \(145, xiv, \[21\]\)/);

    plugin.shutdown(DATA, ADDON_DISABLE);
    expect(w.win.itemMenu.children).toEqual([]);
    expect(w.win.toolsMenu.children).toEqual([]);
    expect(w.win.itemMenu.listenerCount('popupshowing')).toBe(0);
    expect(w.win.document.querySelector('link[href="spdf-zotero.ftl"]')).toBeNull();
    expect(w.sqlite.openCount()).toBe(0);
  });

  it('handles windows opened and closed later, and leaves everything alone at app shutdown', async () => {
    const w = world();
    const plugin = createPlugin(w.globals as never);
    await plugin.startup(DATA, 1);
    const other = fakeWindow(w.pane);
    plugin.onMainWindowLoad({ window: other as never });
    plugin.onMainWindowLoad({ window: other as never }); // twice: still one set of menus
    expect(other.itemMenu.children).toHaveLength(4);
    plugin.onMainWindowUnload({ window: other as never });
    expect(other.itemMenu.children).toHaveLength(0);
    expect(other.document.querySelector('link[href="spdf-zotero.ftl"]')).toBeNull();
    plugin.shutdown(DATA, APP_SHUTDOWN);
    expect(w.win.itemMenu.children).toHaveLength(4);
  });

  it('reads a gzip-wrapped legacy file with the main window DecompressionStream and cleans the temp copy', async () => {
    const path = LEGACY_FILES[0]!;
    const ref = await reference(path);
    const expected = toCslJson(ref.document);
    await ref.close();
    const w = world({ files: [path] });
    expect('DecompressionStream' in w.globals).toBe(false); // like Zotero's sandbox
    const plugin = createPlugin(w.globals as never);
    await plugin.startup(DATA, 1);
    el(w, MENU_IDS.toolsImport).dispatch('command');
    await vi.waitFor(() => expect(w.log.imports).toHaveLength(1));
    expect(w.log.csl[0]).toEqual(expected);
    // the decompressed copy went to Zotero's temp directory, read only, and is gone
    expect(w.sqlite.opens).toEqual([{ path: expect.stringContaining(w.zoteroTmp), readOnly: true }]);
    expect(readdirSync(w.zoteroTmp)).toEqual([]);
    plugin.shutdown(DATA, ADDON_DISABLE);
  });

  it('shows refusals and unexpected errors in a dialog, in Spanish too', async () => {
    const w = world({ files: [ROTO, EN] }, { locale: 'es-ES' });
    const plugin = createPlugin(w.globals as never);
    await plugin.startup(DATA, 1);
    el(w, MENU_IDS.toolsImport).dispatch('command');
    await vi.waitFor(() => expect(w.prompts.alerts).toHaveLength(1));
    expect(w.prompts.alerts[0]).toMatch(/^Este archivo no se puede leer como SPDF\. E020: /);
    w.Z.Attachments.importFromFile = async () => {
      throw new Error('disco lleno');
    };
    el(w, MENU_IDS.toolsImport).dispatch('command');
    await vi.waitFor(() => expect(w.prompts.alerts).toHaveLength(2));
    expect(w.prompts.alerts[1]).toBe('Algo ha fallado: disco lleno');
    expect(w.log.errors).toHaveLength(1);
    plugin.shutdown(DATA, ADDON_DISABLE);
  });
});

describe('Zotero 8: Zotero.MenuManager', () => {
  it('registers the menus with the official API instead of touching the DOM', async () => {
    const w = world({ files: [EN] }, { menuManager: true });
    const plugin = createPlugin(w.globals as never);
    await plugin.startup(DATA, 1);
    expect(w.menus.registered.map((m) => [m.menuID, m.pluginID, m.target, m.menus.map((x: any) => x.l10nID)])).toEqual([
      ['spdf-zotero-tools', DATA.id, 'main/menubar/tools', ['spdf-menu-import']],
      ['spdf-zotero-item', DATA.id, 'main/library/item', ['spdf-menu-import', 'spdf-menu-attach', 'spdf-menu-cite']],
    ]);
    expect(w.win.itemMenu.children).toEqual([]);
    expect(w.win.document.querySelector('link[href="spdf-zotero.ftl"]')).not.toBeNull();

    const [, attach, cite] = w.menus.registered[1]!.menus;
    const visible = (entry: any, items: unknown[]) => {
      let v: boolean | null = null;
      entry.onShowing({}, { items, setVisible: (x: boolean) => (v = x), setEnabled: () => undefined });
      return v;
    };
    const regular = await w.addItem();
    expect([visible(attach, [regular]), visible(cite, [regular])]).toEqual([true, false]);
    await w.addAttachment(regular, EN);
    expect(visible(cite, [regular])).toBe(true);
    expect(visible(attach, [])).toBe(false);

    w.menus.registered[0]!.menus[0].onCommand({ target: { ownerGlobal: w.win } }, {});
    await vi.waitFor(() => expect(w.log.imports).toHaveLength(1));

    plugin.shutdown(DATA, ADDON_DISABLE);
    expect(w.menus.unregistered).toEqual(['spdf-zotero-tools', 'spdf-zotero-item']);
    expect(w.win.document.querySelector('link[href="spdf-zotero.ftl"]')).toBeNull();
  });
});
