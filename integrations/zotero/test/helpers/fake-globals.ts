/**
 * Fakes of the bootstrap-scope globals Zotero hands a plugin (`Services.prompt`,
 * `ChromeUtils.importESModule`, `IOUtils`, `PathUtils`, `Localization`) and of a main
 * window with the two menus the plugin extends. The real host code (`src/host.ts`)
 * runs against them, both from the sources and from the built `bootstrap.js`.
 */

import { mkdirSync } from 'node:fs';
import { open, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fakeSqlite, type FakeSqlite } from './fake-mozstorage.js';
import { translator } from './env.js';

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------

type Listener = (event: { target?: unknown; type: string }) => void;

export class FakeElement {
  id = '';
  hidden = false;
  readonly attributes: Record<string, string> = {};
  readonly children: FakeElement[] = [];
  parent: FakeElement | null = null;
  private readonly listeners = new Map<string, Listener[]>();

  constructor(
    readonly tagName: string,
    readonly ownerDocument: FakeDocument,
  ) {}

  setAttribute(name: string, value: string): void {
    this.attributes[name] = String(value);
  }
  getAttribute(name: string): string | null {
    return this.attributes[name] ?? null;
  }
  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  removeEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((l) => l !== listener));
  }
  listenerCount(type: string): number {
    return this.listeners.get(type)?.length ?? 0;
  }
  appendChild(child: FakeElement): FakeElement {
    child.remove();
    child.parent = this;
    this.children.push(child);
    return child;
  }
  remove(): void {
    if (!this.parent) return;
    const siblings = this.parent.children;
    siblings.splice(siblings.indexOf(this), 1);
    this.parent = null;
  }
  /** Dispatches an event at this element (no bubbling needed here). */
  dispatch(type: string, target: unknown = this): void {
    for (const l of this.listeners.get(type) ?? []) l({ target, type });
  }
}

export class FakeDocument {
  readonly root: FakeElement;
  constructor() {
    this.root = new FakeElement('window', this);
  }
  createXULElement(tag: string): FakeElement {
    return new FakeElement(tag, this);
  }
  createElement(tag: string): FakeElement {
    return new FakeElement(tag, this);
  }
  *walk(el: FakeElement = this.root): Generator<FakeElement> {
    yield el;
    for (const c of el.children) yield* this.walk(c);
  }
  getElementById(id: string): FakeElement | null {
    for (const el of this.walk()) if (el.id === id) return el;
    return null;
  }
  querySelector(selector: string): FakeElement | null {
    const m = /^link\[href="([^"]+)"\]$/.exec(selector);
    if (!m) throw new Error(`fake DOM: unsupported selector ${selector}`);
    for (const el of this.walk()) if (el.tagName === 'link' && el.attributes.href === m[1]) return el;
    return null;
  }
}

export interface FakeWindow {
  document: FakeDocument;
  ZoteroPane: unknown;
  MozXULElement: { insertFTLIfNeeded(file: string): void };
  DecompressionStream?: unknown;
  toolsMenu: FakeElement;
  itemMenu: FakeElement;
}

/** A Zotero main window: a Tools menu popup, the item context menu, Fluent links. */
export function fakeWindow(pane: unknown, withDecompression = true): FakeWindow {
  const document = new FakeDocument();
  const toolsMenu = document.createXULElement('menupopup');
  toolsMenu.id = 'menu_ToolsPopup';
  const itemMenu = document.createXULElement('menupopup');
  itemMenu.id = 'zotero-itemmenu';
  document.root.appendChild(toolsMenu);
  document.root.appendChild(itemMenu);
  const win: FakeWindow = {
    document,
    ZoteroPane: pane,
    toolsMenu,
    itemMenu,
    MozXULElement: {
      insertFTLIfNeeded(file: string) {
        if (document.querySelector(`link[href="${file}"]`)) return;
        const link = document.createElement('link');
        link.setAttribute('href', file);
        document.root.appendChild(link);
      },
    },
  };
  if (withDecompression) win.DecompressionStream = globalThis.DecompressionStream;
  return win;
}

// ---------------------------------------------------------------------------
// Bootstrap scope
// ---------------------------------------------------------------------------

export interface PromptScript {
  files: Array<string | null>;
  prompts: Array<string | null>;
  confirm: boolean;
  select: number | null;
}

export interface PromptLog {
  alerts: string[];
  prompts: string[];
  selects: string[][];
  filePickers: Array<{ title: string; filters: string[] }>;
}

/**
 * The globals of Zotero's plugin sandbox (see `chrome/content/zotero/xpcom/plugins.js`),
 * minus the window. `Zotero` comes from `fakeZotero()` and is extended here.
 */
export function fakeGlobals(Z: Record<string, unknown>, tmp: string, script: Partial<PromptScript> = {}) {
  mkdirSync(tmp, { recursive: true });
  const sqlite: FakeSqlite = fakeSqlite();
  const files = [...(script.files ?? [])];
  const prompts = [...(script.prompts ?? [])];
  const log: PromptLog = { alerts: [], prompts: [], selects: [], filePickers: [] };

  class FilePicker {
    modeOpen = 0;
    returnOK = 0;
    returnCancel = 1;
    filterAll = 1;
    file = '';
    private title = '';
    private filters: string[] = [];
    init(win: unknown, title: string, mode: number) {
      if (!win) throw new Error('FilePicker needs a parent window');
      if (mode !== 0) throw new Error('unexpected mode');
      this.title = title;
    }
    appendFilter(title: string, filter: string) {
      this.filters.push(`${title}|${filter}`);
    }
    appendFilters(mask: number) {
      this.filters.push(`mask:${mask}`);
    }
    async show() {
      log.filePickers.push({ title: this.title, filters: this.filters });
      const f = files.shift() ?? null;
      if (f === null) return this.returnCancel;
      this.file = f;
      return this.returnOK;
    }
  }

  const locale = (Z.locale as string) === 'es-ES' ? 'es-ES' : 'en-US';
  const t = translator(locale);
  class Localization {
    constructor(readonly resources: string[]) {
      if (resources.join() !== 'spdf-zotero.ftl') throw new Error(`unexpected resources ${resources.join()}`);
    }
    formatValue(id: string, args?: Record<string, string | number>) {
      return t(id, args);
    }
  }

  const globals = {
    Zotero: Z,
    Services: {
      prompt: {
        alert(_win: unknown, _title: string, text: string) {
          log.alerts.push(text);
        },
        confirm() {
          return script.confirm ?? false;
        },
        prompt(_win: unknown, _title: string, text: string, value: { value: string }) {
          log.prompts.push(text);
          const next = prompts.shift();
          if (next === null || next === undefined) return false;
          value.value = next;
          return true;
        },
        select(_win: unknown, _title: string, _text: string, options: string[], selected: { value: number }) {
          log.selects.push(options);
          if (script.select === null) return false;
          selected.value = script.select ?? 0;
          return true;
        },
      },
    },
    ChromeUtils: {
      importESModule(url: string) {
        if (url === 'resource://gre/modules/Sqlite.sys.mjs') return { Sqlite: sqlite };
        if (url === 'chrome://zotero/content/modules/filePicker.mjs') return { FilePicker };
        throw new Error(`fake ChromeUtils: unknown module ${url}`);
      },
    },
    IOUtils: {
      async read(path: string, options: { maxBytes?: number } = {}) {
        if (options.maxBytes === undefined) return new Uint8Array(await readFile(path));
        const fh = await open(path, 'r');
        try {
          const buf = new Uint8Array(options.maxBytes);
          const { bytesRead } = await fh.read(buf, 0, options.maxBytes, 0);
          return buf.subarray(0, bytesRead);
        } finally {
          await fh.close();
        }
      },
      async write(path: string, data: Uint8Array) {
        if (!(data instanceof Uint8Array) && Object.prototype.toString.call(data) !== '[object Uint8Array]') throw new TypeError('IOUtils.write needs a Uint8Array');
        await writeFile(path, data);
        return data.byteLength;
      },
      async remove(path: string, options: { ignoreAbsent?: boolean } = {}) {
        await rm(path, { force: !!options.ignoreAbsent });
      },
    },
    PathUtils: { join: (...parts: string[]) => join(...parts), tempDir: tmp },
    Localization,
  };
  return { globals, sqlite, log };
}
