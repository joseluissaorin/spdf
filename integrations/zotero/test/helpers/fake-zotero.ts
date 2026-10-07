/**
 * A fake `Zotero` (items, attachments, the selected pane, the clipboard) and fake
 * dialogs that record everything, for the command handler tests. Only the API surface
 * the plugin uses is modelled, with Zotero 7/8 names and shapes.
 */

import { basename } from 'node:path';
import type { Ui } from '../../src/commands.js';
import type { ZImportFromFileOptions, ZItem, ZPane, ZoteroLike } from '../../src/zotero-types.js';

export interface ZoteroLog {
  csl: unknown[];
  saved: number[];
  imports: ZImportFromFileOptions[];
  clipboard: string[];
  selected: number[];
  errors: unknown[];
}

export interface FakeZoteroOptions {
  locale?: string;
  canEdit?: boolean;
  libraryID?: number;
  collection?: { id: number } | false;
}

export function fakeZotero(options: FakeZoteroOptions = {}) {
  const items = new Map<number, FakeItem>();
  let nextId = 1;
  const log: ZoteroLog = { csl: [], saved: [], imports: [], clipboard: [], selected: [], errors: [] };

  class FakeItem implements ZItem {
    id = 0;
    libraryID = 1;
    itemType: string | null;
    fields: Record<string, string> = {};
    creators: unknown[] = [];
    collections: number[] = [];
    parentItemID: number | false = false;
    attachmentContentType?: string;
    attachmentFilename?: string;
    filePath: string | false = false;

    constructor(itemType?: string) {
      this.itemType = itemType ?? null;
    }
    isRegularItem() {
      return this.itemType !== null && this.itemType !== 'attachment' && this.itemType !== 'note';
    }
    isAttachment() {
      return this.itemType === 'attachment';
    }
    getAttachments() {
      return [...items.values()].filter((i) => i.isAttachment() && i.parentItemID === this.id).map((i) => i.id);
    }
    getField(field: string) {
      return this.fields[field] ?? '';
    }
    setField(field: string, value: string) {
      this.fields[field] = value;
      return true;
    }
    setCollections(ids: number[]) {
      this.collections = [...ids];
    }
    async saveTx() {
      if (this.itemType === null) throw new Error('Item type must be set before saving');
      if (!this.id) {
        this.id = nextId++;
        items.set(this.id, this);
      }
      log.saved.push(this.id);
      return this.id;
    }
    async getFilePathAsync() {
      return this.filePath;
    }
    getDisplayTitle() {
      return this.fields.title ?? '';
    }
  }

  interface FakePane extends ZPane {
    selected: ZItem[];
    libraryID: number;
    collection: { id: number } | false;
    editable: boolean;
  }
  const pane: FakePane = {
    selected: [] as ZItem[],
    libraryID: options.libraryID ?? 1,
    collection: options.collection ?? (false as { id: number } | false),
    editable: options.canEdit ?? true,
    getSelectedItems() {
      return pane.selected;
    },
    getSelectedLibraryID() {
      return pane.libraryID;
    },
    getSelectedCollection() {
      return pane.collection;
    },
    canEdit() {
      return pane.editable;
    },
    selectItem(id: number) {
      log.selected.push(id);
    },
  };

  const Z = {
    Item: FakeItem,
    Items: {
      get: ((ids: number | number[]) =>
        Array.isArray(ids) ? ids.map((id) => items.get(id)).filter((x): x is FakeItem => !!x) : (items.get(ids) ?? false)) as ZoteroLike['Items']['get'],
    },
    Utilities: {
      Item: {
        // Like Zotero's: sets the type from the CSL type, then fields and creators.
        itemFromCSLJSON(item: ZItem, csl: Record<string, unknown>) {
          log.csl.push(structuredClone(csl));
          if (!csl.type) throw new Error("No 'type' provided in CSL-JSON");
          const it = item as FakeItem;
          it.itemType = csl.type === 'pamphlet' ? 'document' : csl.type === 'speech' ? 'presentation' : 'book';
          if (typeof csl.title === 'string') it.fields.title = csl.title;
          if (typeof csl.note === 'string') it.fields.extra = csl.note;
          if (typeof csl.publisher === 'string') it.fields.publisher = csl.publisher;
          it.creators = Array.isArray(csl.author) ? csl.author : [];
        },
      },
      Internal: {
        copyTextToClipboard(text: string) {
          log.clipboard.push(text);
        },
      },
    },
    Attachments: {
      async importFromFile(o: ZImportFromFileOptions) {
        log.imports.push({ ...o });
        if (o.parentItemID && !items.has(o.parentItemID)) throw new Error('parent item does not exist');
        const a = new FakeItem('attachment');
        a.parentItemID = o.parentItemID ?? false;
        a.attachmentContentType = o.contentType ?? 'application/octet-stream';
        a.attachmentFilename = basename(o.file);
        a.fields.title = basename(o.file);
        a.filePath = o.file;
        await a.saveTx();
        return a;
      },
    },
    locale: options.locale ?? 'en-US',
    getActiveZoteroPane: () => pane,
    getMainWindow: () => null,
    logError: (e: unknown) => log.errors.push(e),
    debug: () => undefined,
  } satisfies ZoteroLike;

  /** A regular item already in the library. */
  async function addItem(fields: Record<string, string> = {}): Promise<FakeItem> {
    const it = new FakeItem('book');
    Object.assign(it.fields, fields);
    await it.saveTx();
    return it;
  }

  /** An attachment (file path, or false for a missing file) under `parent`. */
  async function addAttachment(parent: FakeItem | null, path: string | false, contentType = 'application/vnd.spdf', filename?: string): Promise<FakeItem> {
    const a = new FakeItem('attachment');
    a.parentItemID = parent ? parent.id : false;
    a.attachmentContentType = contentType;
    a.attachmentFilename = filename ?? (path ? basename(path) : 'missing.spdf');
    a.fields.title = a.attachmentFilename;
    a.filePath = path;
    await a.saveTx();
    return a;
  }

  return { Z: Z as ZoteroLike & typeof Z, pane, items, log, FakeItem, addItem, addAttachment };
}

export interface UiScript {
  pickFile?: string | null;
  prompts?: Array<string | null>;
  confirm?: boolean;
  select?: number | null;
}

export interface UiLog {
  alerts: string[];
  confirms: string[];
  prompts: string[];
  selects: Array<{ message: string; options: string[] }>;
  notices: Array<[string, string]>;
  picks: string[];
}

export function fakeUi(script: UiScript = {}): { ui: Ui; log: UiLog } {
  const log: UiLog = { alerts: [], confirms: [], prompts: [], selects: [], notices: [], picks: [] };
  const prompts = [...(script.prompts ?? [])];
  const ui: Ui = {
    async pickFile(title) {
      log.picks.push(title);
      return script.pickFile ?? null;
    },
    prompt(_title, message) {
      log.prompts.push(message);
      return prompts.length ? (prompts.shift() as string | null) : null;
    },
    alert(_title, message) {
      log.alerts.push(message);
    },
    confirm(_title, message) {
      log.confirms.push(message);
      return script.confirm ?? false;
    },
    select(_title, message, options) {
      log.selects.push({ message, options });
      return script.select === undefined ? 0 : script.select;
    },
    notify(headline, body) {
      log.notices.push([headline, body]);
    },
  };
  return { ui, log };
}
