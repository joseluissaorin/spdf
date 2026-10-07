/**
 * The small slice of Zotero's API the plugin touches, typed so the command handlers
 * can be tested with a fake `Zotero` object. Names and signatures follow Zotero 7/8.
 */

export interface ZItem {
  id: number;
  libraryID: number;
  parentItemID?: number | false | null;
  attachmentContentType?: string;
  attachmentFilename?: string;
  isRegularItem(): boolean;
  isAttachment(): boolean;
  getAttachments(includeTrashed?: boolean): number[];
  getField(field: string): string;
  setField(field: string, value: string): unknown;
  setCollections(ids: number[]): void;
  saveTx(): Promise<unknown>;
  getFilePathAsync?(): Promise<string | false>;
  getDisplayTitle?(): string;
}

export interface ZCollection {
  id: number;
}

export interface ZPane {
  getSelectedItems(): ZItem[];
  getSelectedLibraryID(): number;
  getSelectedCollection(): ZCollection | false | null | undefined;
  canEdit(): boolean;
  selectItem?(id: number): unknown;
}

export interface ZImportFromFileOptions {
  file: string;
  parentItemID?: number;
  libraryID?: number;
  contentType?: string;
}

export interface ZProgressWindow {
  changeHeadline(text: string): void;
  addDescription(text: string): void;
  show(): void;
  startCloseTimer(ms?: number): void;
}

/** A menu registered with Zotero 8's `Zotero.MenuManager`. */
export interface ZMenuData {
  menuType: 'menuitem' | 'separator' | 'submenu';
  l10nID?: string;
  onShowing?: (event: unknown, context: ZMenuContext) => void;
  onCommand?: (event: unknown, context: ZMenuContext) => void;
}

export interface ZMenuContext {
  items?: ZItem[];
  setVisible(visible: boolean): void;
  setEnabled(enabled: boolean): void;
}

export interface ZoteroLike {
  Item: new (itemType?: string) => ZItem;
  Items: { get(ids: number[]): ZItem[] } & { get(id: number): ZItem | false };
  Utilities: {
    Item: { itemFromCSLJSON(item: ZItem, csl: unknown): void };
    Internal: { copyTextToClipboard(text: string): void };
  };
  Attachments: { importFromFile(options: ZImportFromFileOptions): Promise<ZItem> };
  ProgressWindow?: new () => ZProgressWindow;
  MenuManager?: {
    registerMenu(options: { menuID: string; pluginID: string; target: string; menus: ZMenuData[] }): string | false;
    unregisterMenu(id: string): boolean;
  };
  initializationPromise?: Promise<unknown>;
  locale?: string;
  getActiveZoteroPane(): ZPane | null;
  getMainWindow(): ZWindow | null;
  getMainWindows?(): ZWindow[];
  getTempDirectory?(): { path: string };
  debug?(message: string): void;
  logError?(error: unknown): void;
}

/** The parts of a main window the plugin touches. */
export interface ZWindow {
  document: ZDocument;
  ZoteroPane?: ZPane;
  MozXULElement?: { insertFTLIfNeeded(file: string): void };
  DecompressionStream?: unknown;
}

export interface ZElement {
  id: string;
  hidden: boolean;
  setAttribute(name: string, value: string): void;
  addEventListener(type: string, listener: (event: { target?: unknown }) => void): void;
  removeEventListener(type: string, listener: (event: { target?: unknown }) => void): void;
  appendChild(child: ZElement): unknown;
  remove(): void;
}

export interface ZDocument {
  getElementById(id: string): ZElement | null;
  createXULElement(tag: string): ZElement;
  querySelector(selector: string): { remove(): void } | null;
}
