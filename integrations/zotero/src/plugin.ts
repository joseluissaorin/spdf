/**
 * Entry point of the bundle. `bootstrap.js` is this file compiled to one IIFE
 * (`SpdfZotero`) followed by the bootstrap hooks Zotero calls (see
 * `scripts/build.mjs`). The hooks pass the bootstrap scope's globals to
 * `createPlugin`, which keeps the plugin free of assumptions about which global names
 * the sandbox happens to have, and lets the tests drive it with fakes.
 */

import type { SqlEngine } from 'spdf-format/core';
import { attachSpdf, canAttach, canCite, copyCitationWithFolio, importSpdfAsItem, type CommandEnv } from './commands.js';
import { mozStorageEngine } from './engine.js';
import { FTL_FILE, zoteroHost, zoteroTranslate, zoteroUi, type PluginGlobals } from './host.js';
import { addDomMenus, registerMenus, removeDomMenus, unregisterMenus, type MenuActions } from './menus.js';
import { describeError } from './spdf.js';
import type { ZWindow } from './zotero-types.js';

export { VERSION } from './version.js';
export type { PluginGlobals } from './host.js';

/** Bootstrap reason codes (the subset used here). */
const APP_SHUTDOWN = 2;

export interface BootstrapData {
  id: string;
  version: string;
  rootURI: string;
}

export interface Plugin {
  startup(data: BootstrapData, reason?: number): Promise<void>;
  shutdown(data?: BootstrapData, reason?: number): void;
  onMainWindowLoad(params: { window: ZWindow }): void;
  onMainWindowUnload(params: { window: ZWindow }): void;
  /** The SQL engine (for tests and for other code in the same scope). */
  readonly engine: SqlEngine;
  /** Builds the command environment for a window (tests use it to call commands directly). */
  env(win: ZWindow | null): CommandEnv;
}

export interface PluginOptions {
  /** Replaces the dialogs (tests). */
  ui?: (win: ZWindow | null) => CommandEnv['ui'];
  /** Replaces the Fluent strings (tests). */
  t?: CommandEnv['t'];
}

export function createPlugin(g: PluginGlobals, options: PluginOptions = {}): Plugin {
  const Z = g.Zotero;
  const engine = mozStorageEngine(zoteroHost(g));
  const t = options.t ?? zoteroTranslate(g);
  const ui = options.ui ?? ((win: ZWindow | null) => zoteroUi(g, win));
  let pluginID = 'spdf@joseluissaorin.com';
  let menuKeys: string[] = [];
  let useMenuManager = false;
  const windows = new Set<ZWindow>();

  const env = (win: ZWindow | null): CommandEnv => ({
    Zotero: Z,
    ui: ui(win ?? Z.getMainWindow()),
    t,
    engine,
    locale: Z.locale || 'en-US',
  });

  /** Runs a command; anything unexpected is logged and shown, never swallowed. */
  const run = (command: (e: CommandEnv) => Promise<unknown>) => (win: ZWindow | null) => {
    const e = env(win);
    command(e).catch(async (err: unknown) => {
      Z.logError?.(err);
      try {
        e.ui.alert(await t('spdf-error-title'), await t('spdf-unexpected-error', { message: describeError(err) }));
      } catch {
        /* nothing else to do */
      }
    });
  };

  const actions: MenuActions = {
    importItem: run(importSpdfAsItem),
    attach: run(attachSpdf),
    cite: run(copyCitationWithFolio),
    canAttach,
    canCite: (items) => canCite(Z, items),
  };

  const addToWindow = (win: ZWindow) => {
    if (windows.has(win)) return;
    windows.add(win);
    // Labels of both menu paths come from this Fluent file.
    win.MozXULElement?.insertFTLIfNeeded(FTL_FILE);
    if (!useMenuManager) addDomMenus(win, actions);
  };

  const removeFromWindow = (win: ZWindow) => {
    windows.delete(win);
    removeDomMenus(win);
    win.document.querySelector(`link[href="${FTL_FILE}"]`)?.remove();
  };

  return {
    engine,
    env,
    async startup(data) {
      pluginID = data?.id || pluginID;
      Z.debug?.(`SPDF for Zotero ${data?.version ?? ''} starting`);
      await Z.initializationPromise;
      useMenuManager = typeof Z.MenuManager?.registerMenu === 'function';
      if (useMenuManager) menuKeys = registerMenus(Z, pluginID, actions);
      const wins = Z.getMainWindows ? Z.getMainWindows() : [Z.getMainWindow()].filter((w): w is ZWindow => !!w);
      for (const win of wins) if (win.ZoteroPane) addToWindow(win);
    },
    shutdown(_data, reason) {
      if (reason === APP_SHUTDOWN) return; // Zotero is quitting: nothing to undo
      unregisterMenus(Z, menuKeys);
      menuKeys = [];
      for (const win of [...windows]) removeFromWindow(win);
    },
    onMainWindowLoad({ window }) {
      addToWindow(window);
    },
    onMainWindowUnload({ window }) {
      removeFromWindow(window);
    },
  };
}
