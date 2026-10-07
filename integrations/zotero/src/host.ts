/**
 * The Mozilla side: the engine host over `IOUtils`, `PathUtils` and `Sqlite.sys.mjs`,
 * the dialogs over `Services.prompt` and Zotero's `FilePicker`, and the Fluent strings.
 *
 * These are the only lines that need a real Zotero. They receive the bootstrap scope's
 * globals explicitly (see `plugin.ts`), so nothing here relies on a global name being
 * present in the plugin sandbox.
 */

import type { EngineHost, SqliteModule } from './engine.js';
import type { DecompressionStreamCtor } from './bytes.js';
import type { Translate, Ui } from './commands.js';
import type { ZWindow, ZoteroLike } from './zotero-types.js';

/** The globals Zotero puts in a plugin's bootstrap scope (Zotero 7 and 8). */
export interface PluginGlobals {
  Zotero: ZoteroLike;
  Services: {
    prompt: {
      alert(win: unknown, title: string, text: string): void;
      confirm(win: unknown, title: string, text: string): boolean;
      prompt(win: unknown, title: string, text: string, value: { value: string }, checkLabel: string | null, checkState: { value: boolean }): boolean;
      select(win: unknown, title: string, text: string, options: string[], selected: { value: number }): boolean;
    };
  };
  ChromeUtils: { importESModule(url: string): Record<string, unknown> };
  IOUtils: {
    read(path: string, options?: { maxBytes?: number }): Promise<unknown>;
    write(path: string, data: Uint8Array): Promise<unknown>;
    remove(path: string, options?: { ignoreAbsent?: boolean }): Promise<unknown>;
  };
  PathUtils: { join(...parts: string[]): string; tempDir?: string };
  Localization?: new (resources: string[]) => { formatValue(id: string, args?: Record<string, unknown>): Promise<string | null | undefined> };
  /** Only if a future sandbox exposes it; otherwise it is taken from the main window. */
  DecompressionStream?: unknown;
}

export const FTL_FILE = 'spdf-zotero.ftl';
const SQLITE_MODULE = 'resource://gre/modules/Sqlite.sys.mjs';
const FILE_PICKER_MODULE = 'chrome://zotero/content/modules/filePicker.mjs';

let counter = 0;

/** The engine host of a running Zotero. */
export function zoteroHost(g: PluginGlobals): EngineHost {
  const tempDir = (): string => {
    try {
      const dir = g.Zotero.getTempDirectory?.();
      if (dir?.path) return dir.path;
    } catch {
      /* fall back to the system temp directory */
    }
    if (g.PathUtils.tempDir) return g.PathUtils.tempDir;
    throw new Error('No temporary directory available.');
  };
  return {
    sqlite: () => g.ChromeUtils.importESModule(SQLITE_MODULE).Sqlite as SqliteModule,
    readFile: (path) => g.IOUtils.read(path),
    readFileHead: (path, length) => g.IOUtils.read(path, { maxBytes: length }),
    writeFile: (path, data) => g.IOUtils.write(path, data),
    remove: (path) => g.IOUtils.remove(path, { ignoreAbsent: true }),
    tempPath: (prefix) => g.PathUtils.join(tempDir(), `${prefix}${Date.now().toString(36)}-${(counter++).toString(36)}-${Math.random().toString(36).slice(2, 10)}.sqlite`),
    decompressionStream: () => {
      // The plugin sandbox has no Compression Streams; the main window (a privileged
      // Firefox window, Firefox ≥ 113) does.
      const own = g.DecompressionStream;
      if (typeof own === 'function') return own as DecompressionStreamCtor;
      const win = g.Zotero.getMainWindow();
      const fromWindow = win?.DecompressionStream;
      return typeof fromWindow === 'function' ? (fromWindow as DecompressionStreamCtor) : undefined;
    },
  };
}

/** Dialogs bound to a window. */
export function zoteroUi(g: PluginGlobals, win: ZWindow | null): Ui {
  return {
    async pickFile(title) {
      const { FilePicker } = g.ChromeUtils.importESModule(FILE_PICKER_MODULE) as {
        FilePicker: new () => {
          modeOpen: number;
          returnOK: number;
          filterAll: number;
          file: string;
          init(win: unknown, title: string, mode: number): void;
          appendFilter(title: string, filter: string): void;
          appendFilters(mask: number): void;
          show(): Promise<number>;
        };
      };
      const fp = new FilePicker();
      fp.init(win, title, fp.modeOpen);
      fp.appendFilter('SPDF (*.spdf)', '*.spdf');
      fp.appendFilters(fp.filterAll);
      const rv = await fp.show();
      return rv === fp.returnOK && fp.file ? fp.file : null;
    },
    prompt(title, message) {
      const value = { value: '' };
      return g.Services.prompt.prompt(win, title, message, value, null, { value: false }) ? value.value : null;
    },
    alert(title, message) {
      g.Services.prompt.alert(win, title, message);
    },
    confirm(title, message) {
      return g.Services.prompt.confirm(win, title, message);
    },
    select(title, message, options) {
      const selected = { value: 0 };
      return g.Services.prompt.select(win, title, message, options, selected) ? selected.value : null;
    },
    notify(headline, body) {
      try {
        const PW = g.Zotero.ProgressWindow;
        if (!PW) return;
        const pw = new PW();
        pw.changeHeadline(headline);
        pw.addDescription(body);
        pw.show();
        pw.startCloseTimer(4000);
      } catch (e) {
        g.Zotero.logError?.(e);
      }
    },
  };
}

/** Fluent strings from `locale/<lang>/spdf-zotero.ftl`. Falls back to the id if missing. */
export function zoteroTranslate(g: PluginGlobals): Translate {
  let l10n: { formatValue(id: string, args?: Record<string, unknown>): Promise<string | null | undefined> } | null = null;
  return async (id, args) => {
    try {
      if (!l10n && g.Localization) l10n = new g.Localization([FTL_FILE]);
      const s = l10n ? await l10n.formatValue(id, args) : null;
      return typeof s === 'string' && s ? s : id;
    } catch (e) {
      g.Zotero.logError?.(e);
      return id;
    }
  };
}
