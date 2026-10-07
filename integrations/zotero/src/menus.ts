/**
 * Menu entries. Zotero 8 has an official menu API (`Zotero.MenuManager`), which
 * survives changes in Zotero's own markup; Zotero 7 does not, so there the items are
 * added to the DOM of each main window, as Zotero's sample plugin does. Both use the
 * same Fluent ids, so the labels come from `spdf-zotero.ftl` either way.
 */

import type { ZDocument, ZElement, ZItem, ZMenuContext, ZWindow, ZoteroLike } from './zotero-types.js';

export const MENU_IDS = {
  toolsImport: 'spdf-zotero-tools-import',
  itemSeparator: 'spdf-zotero-item-separator',
  itemImport: 'spdf-zotero-item-import',
  itemAttach: 'spdf-zotero-item-attach',
  itemCite: 'spdf-zotero-item-cite',
} as const;

export const L10N_IDS = {
  import: 'spdf-menu-import',
  attach: 'spdf-menu-attach',
  cite: 'spdf-menu-cite',
} as const;

/** What the menus do, and when the item-specific entries are shown. */
export interface MenuActions {
  importItem(win: ZWindow | null): void;
  attach(win: ZWindow | null): void;
  cite(win: ZWindow | null): void;
  canAttach(items: ZItem[]): boolean;
  canCite(items: ZItem[]): boolean;
}

// ---------------------------------------------------------------------------
// Zotero 8: MenuManager
// ---------------------------------------------------------------------------

function windowOf(Z: ZoteroLike, event: unknown): ZWindow | null {
  const target = (event as { target?: { ownerGlobal?: ZWindow } } | null)?.target;
  return target?.ownerGlobal ?? Z.getMainWindow();
}

function selectedItems(Z: ZoteroLike, context: ZMenuContext): ZItem[] {
  if (Array.isArray(context?.items)) return context.items;
  return Z.getActiveZoteroPane()?.getSelectedItems() ?? [];
}

/** Registers the menus with `Zotero.MenuManager`; returns the ids to unregister them. */
export function registerMenus(Z: ZoteroLike, pluginID: string, actions: MenuActions): string[] {
  const mm = Z.MenuManager;
  if (!mm) return [];
  const keys: string[] = [];
  const tools = mm.registerMenu({
    menuID: 'spdf-zotero-tools',
    pluginID,
    target: 'main/menubar/tools',
    menus: [{ menuType: 'menuitem', l10nID: L10N_IDS.import, onCommand: (ev) => actions.importItem(windowOf(Z, ev)) }],
  });
  if (tools) keys.push(tools);
  const item = mm.registerMenu({
    menuID: 'spdf-zotero-item',
    pluginID,
    target: 'main/library/item',
    menus: [
      { menuType: 'menuitem', l10nID: L10N_IDS.import, onCommand: (ev) => actions.importItem(windowOf(Z, ev)) },
      {
        menuType: 'menuitem',
        l10nID: L10N_IDS.attach,
        onShowing: (_ev, ctx) => ctx.setVisible(actions.canAttach(selectedItems(Z, ctx))),
        onCommand: (ev) => actions.attach(windowOf(Z, ev)),
      },
      {
        menuType: 'menuitem',
        l10nID: L10N_IDS.cite,
        onShowing: (_ev, ctx) => ctx.setVisible(actions.canCite(selectedItems(Z, ctx))),
        onCommand: (ev) => actions.cite(windowOf(Z, ev)),
      },
    ],
  });
  if (item) keys.push(item);
  return keys;
}

export function unregisterMenus(Z: ZoteroLike, keys: readonly string[]): void {
  for (const k of keys) {
    try {
      Z.MenuManager?.unregisterMenu(k);
    } catch (e) {
      Z.logError?.(e);
    }
  }
}

// ---------------------------------------------------------------------------
// Zotero 7: DOM
// ---------------------------------------------------------------------------

const cleanups = new WeakMap<ZWindow, () => void>();

function menuitem(doc: ZDocument, id: string, l10nId: string, onCommand: () => void): ZElement {
  const el = doc.createXULElement('menuitem');
  el.id = id;
  el.setAttribute('data-l10n-id', l10nId);
  el.addEventListener('command', () => onCommand());
  return el;
}

/** Adds the entries to the Tools menu and the item context menu of one main window. */
export function addDomMenus(win: ZWindow, actions: MenuActions): void {
  const doc = win.document;
  if (doc.getElementById(MENU_IDS.toolsImport) || doc.getElementById(MENU_IDS.itemImport)) return;
  const tools = doc.getElementById('menu_ToolsPopup');
  tools?.appendChild(menuitem(doc, MENU_IDS.toolsImport, L10N_IDS.import, () => actions.importItem(win)));

  const popup = doc.getElementById('zotero-itemmenu');
  if (!popup) return;
  const separator = doc.createXULElement('menuseparator');
  separator.id = MENU_IDS.itemSeparator;
  const importItem = menuitem(doc, MENU_IDS.itemImport, L10N_IDS.import, () => actions.importItem(win));
  const attach = menuitem(doc, MENU_IDS.itemAttach, L10N_IDS.attach, () => actions.attach(win));
  const cite = menuitem(doc, MENU_IDS.itemCite, L10N_IDS.cite, () => actions.cite(win));
  for (const el of [separator, importItem, attach, cite]) popup.appendChild(el);

  const onShowing = (event: { target?: unknown }) => {
    if (event.target !== popup) return; // submenus bubble their own popupshowing
    let items: ZItem[] = [];
    try {
      items = win.ZoteroPane?.getSelectedItems() ?? [];
    } catch {
      items = [];
    }
    attach.hidden = !actions.canAttach(items);
    cite.hidden = !actions.canCite(items);
  };
  popup.addEventListener('popupshowing', onShowing);
  cleanups.set(win, () => popup.removeEventListener('popupshowing', onShowing));
}

export function removeDomMenus(win: ZWindow): void {
  cleanups.get(win)?.();
  cleanups.delete(win);
  for (const id of Object.values(MENU_IDS)) win.document.getElementById(id)?.remove();
}
