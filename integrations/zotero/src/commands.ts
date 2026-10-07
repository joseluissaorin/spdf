/**
 * The three commands of the plugin, written against an injected environment (the
 * `Zotero` object, dialogs, strings, the SQL engine) so that the tests can run them
 * with a fake Zotero and real SPDF files.
 */

import type { SpdfDocument, SqlEngine } from 'spdf-format/core';
import { citationFor, parseQuery, resolveQuery, unitLabel, sameDocument, type Citation, type Match, type Query } from './locate.js';
import { MEDIA_TYPE, cslForZotero, describeError, openDocument, withSpdfLine } from './spdf.js';
import type { ZItem, ZoteroLike } from './zotero-types.js';

/** Dialogs, bound to one window. */
export interface Ui {
  /** Asks for a `.spdf` file; null if cancelled. */
  pickFile(title: string): Promise<string | null>;
  /** Asks for a line of text; null if cancelled. */
  prompt(title: string, message: string): Promise<string | null> | string | null;
  alert(title: string, message: string): void;
  confirm(title: string, message: string): boolean;
  /** Lets the user choose one option; its index, or null if cancelled. */
  select(title: string, message: string, options: string[]): number | null;
  /** A short, self-closing notice. */
  notify(headline: string, body: string): void;
}

/** Localized strings (Fluent ids from `spdf-zotero.ftl`). */
export type Translate = (id: string, args?: Record<string, string | number>) => Promise<string>;

export interface CommandEnv {
  Zotero: ZoteroLike;
  ui: Ui;
  t: Translate;
  engine: SqlEngine;
  /** Zotero's UI locale (`Zotero.locale`); citations use es or en, falling back to en. */
  locale: string;
}

// ---------------------------------------------------------------------------
// Which items the commands apply to
// ---------------------------------------------------------------------------

/** An attachment item holding an SPDF file (by media type or by extension). */
export function isSpdfAttachment(item: ZItem): boolean {
  if (!item.isAttachment()) return false;
  if (item.attachmentContentType === MEDIA_TYPE) return true;
  return /\.spdf$/i.test(item.attachmentFilename ?? '');
}

/**
 * The SPDF attachments a citation can come from: the item itself if it is one, the
 * children of a regular item, or the siblings of another attachment (so a PDF and its
 * SPDF reading can sit side by side under the same parent).
 */
export function spdfAttachmentsOf(Z: ZoteroLike, item: ZItem): ZItem[] {
  if (item.isAttachment()) {
    if (isSpdfAttachment(item)) return [item];
    if (!item.parentItemID) return [];
    const parent = Z.Items.get(item.parentItemID);
    return parent ? spdfAttachmentsOf(Z, parent) : [];
  }
  if (!item.isRegularItem()) return [];
  const ids = item.getAttachments();
  return ids.length ? Z.Items.get(ids).filter(isSpdfAttachment) : [];
}

/** "Attach SPDF…" applies to exactly one regular item. */
export function canAttach(items: readonly ZItem[]): boolean {
  return items.length === 1 && (items[0] as ZItem).isRegularItem();
}

/** "Copy citation with folio…" applies to one item with an SPDF attachment, or an SPDF attachment. */
export function canCite(Z: ZoteroLike, items: readonly ZItem[]): boolean {
  if (items.length !== 1) return false;
  try {
    return spdfAttachmentsOf(Z, items[0] as ZItem).length > 0;
  } catch {
    return true; // let the command explain what is wrong
  }
}

// ---------------------------------------------------------------------------
// Shared steps
// ---------------------------------------------------------------------------

/**
 * Opens the file as a reader must (SPEC §2.4): what cannot be opened safely (not
 * SQLite, unknown version, a view or trigger, an unknown required extension…) is
 * refused with its code. Full validation is not run here: its content-hash step
 * re-reads every blob, which through mozStorage is slow for a large book, and a
 * reference manager only needs the metadata and the anchors. Use a validator
 * (the website, or `spdf-format validate`) to audit a file.
 */
async function openOrExplain(env: CommandEnv, path: string): Promise<SpdfDocument | null> {
  try {
    return await openDocument(path, env.engine);
  } catch (e) {
    env.ui.alert(await env.t('spdf-error-title'), await env.t('spdf-open-failed', { reason: describeError(e) }));
    return null;
  }
}

function titleOf(item: ZItem): string {
  return (item.getDisplayTitle?.() || item.getField('title') || item.attachmentFilename || String(item.id)).trim();
}

// ---------------------------------------------------------------------------
// Import SPDF as item…
// ---------------------------------------------------------------------------

/**
 * Asks for an `.spdf` file, creates a Zotero item from its CSL-JSON metadata in the
 * selected library and collection, keeps `SPDF: sha256-…` in Extra and attaches the
 * file (copied into Zotero's storage). Returns the new item, or null.
 */
export async function importSpdfAsItem(env: CommandEnv): Promise<ZItem | null> {
  const { Zotero: Z, ui, t } = env;
  const pane = Z.getActiveZoteroPane();
  if (!pane) return null;
  if (!pane.canEdit()) {
    ui.alert(await t('spdf-error-title'), await t('spdf-library-readonly'));
    return null;
  }
  const path = await ui.pickFile(await t('spdf-pick-import-title'));
  if (!path) return null;
  const doc = await openOrExplain(env, path);
  if (!doc) return null;
  let csl;
  let docref;
  try {
    csl = cslForZotero(doc);
    docref = doc.docref;
  } finally {
    // Close before Zotero copies the file: an open SQLite handle can hold a lock.
    await doc.close();
  }
  const item = new Z.Item();
  item.libraryID = pane.getSelectedLibraryID();
  Z.Utilities.Item.itemFromCSLJSON(item, csl);
  item.setField('extra', withSpdfLine(item.getField('extra'), docref));
  const collection = pane.getSelectedCollection();
  if (collection) item.setCollections([collection.id]);
  await item.saveTx();
  await Z.Attachments.importFromFile({ file: path, parentItemID: item.id, contentType: MEDIA_TYPE });
  await pane.selectItem?.(item.id);
  ui.notify(await t('spdf-imported'), String(csl.title ?? ''));
  return item;
}

// ---------------------------------------------------------------------------
// Attach SPDF…
// ---------------------------------------------------------------------------

/** Attaches an `.spdf` file to the selected regular item and records its hash in Extra. */
export async function attachSpdf(env: CommandEnv): Promise<ZItem | null> {
  const { Zotero: Z, ui, t } = env;
  const pane = Z.getActiveZoteroPane();
  if (!pane) return null;
  const items = pane.getSelectedItems();
  if (!canAttach(items)) {
    ui.alert(await t('spdf-error-title'), await t('spdf-select-one-item'));
    return null;
  }
  if (!pane.canEdit()) {
    ui.alert(await t('spdf-error-title'), await t('spdf-library-readonly'));
    return null;
  }
  const parent = items[0] as ZItem;
  const path = await ui.pickFile(await t('spdf-pick-attach-title'));
  if (!path) return null;
  const doc = await openOrExplain(env, path);
  if (!doc) return null;
  const docref = doc.docref;
  await doc.close();

  const attachment = await Z.Attachments.importFromFile({ file: path, parentItemID: parent.id, contentType: MEDIA_TYPE });
  const extra = withSpdfLine(parent.getField('extra'), docref);
  if (extra !== parent.getField('extra')) {
    parent.setField('extra', extra);
    await parent.saveTx();
  }
  ui.notify(await t('spdf-attached'), titleOf(parent));
  return attachment;
}

// ---------------------------------------------------------------------------
// Copy citation with folio…
// ---------------------------------------------------------------------------

async function notFoundMessage(env: CommandEnv, query: Query, detail: string): Promise<string> {
  // A URI is resolved by its `p` first, then by its `f` (SPEC §5.4): say which failed.
  const byPage = query.kind === 'physical' || (query.kind === 'uri' && query.locator.p !== undefined);
  const byFolio = query.kind === 'printed' || (query.kind === 'uri' && query.locator.f !== undefined);
  if (byPage) return env.t('spdf-page-not-found', { page: detail });
  if (byFolio) return env.t('spdf-folio-not-found', { folio: detail });
  return env.t('spdf-anchor-not-found');
}

/** Opens the attachment's file, or explains why it cannot. */
async function openAttachment(env: CommandEnv, att: ZItem): Promise<SpdfDocument | null> {
  const path = att.getFilePathAsync ? await att.getFilePathAsync() : false;
  if (!path) {
    env.ui.alert(await env.t('spdf-error-title'), await env.t('spdf-file-missing', { name: titleOf(att) }));
    return null;
  }
  return openOrExplain(env, path);
}

/**
 * Asks for a printed folio, a physical page or an anchor URI, finds the unit in the
 * SPDF attachment and copies the short citation and, on the next line, the anchor URI.
 * Nothing is copied when the folio or page does not exist. Returns what was copied.
 */
export async function copyCitationWithFolio(env: CommandEnv): Promise<Citation | null> {
  const { Zotero: Z, ui, t } = env;
  const pane = Z.getActiveZoteroPane();
  if (!pane) return null;
  const items = pane.getSelectedItems();
  const title = await t('spdf-cite-title');
  if (items.length !== 1) {
    ui.alert(title, await t('spdf-select-one-item'));
    return null;
  }
  const attachments = spdfAttachmentsOf(Z, items[0] as ZItem);
  if (!attachments.length) {
    ui.alert(title, await t('spdf-no-attachment'));
    return null;
  }
  const input = await ui.prompt(title, await t('spdf-cite-prompt'));
  if (input === null || input === undefined) return null;
  const query = parseQuery(input);
  if (!query) {
    ui.alert(title, await t('spdf-cite-invalid', { input: input.trim() }));
    return null;
  }

  // Which attachment: the one the anchor URI names, or the one the user picks.
  let doc: SpdfDocument | null = null;
  if (query.kind === 'uri') {
    for (const att of attachments) {
      const d = await openAttachment(env, att);
      if (!d) continue;
      if (sameDocument(d, query.docref)) {
        doc = d;
        break;
      }
      await d.close();
    }
    if (!doc) {
      ui.alert(title, await t('spdf-other-document', { docref: query.docref }));
      return null;
    }
  } else {
    let att = attachments[0] as ZItem;
    if (attachments.length > 1) {
      const i = ui.select(title, await t('spdf-choose-attachment'), attachments.map(titleOf));
      if (i === null || !attachments[i]) return null;
      att = attachments[i] as ZItem;
    }
    doc = await openAttachment(env, att);
    if (!doc) return null;
  }

  try {
    const res = await resolveQuery(doc, query);
    if (!res.ok) {
      ui.alert(title, res.reason === 'other-document' ? await t('spdf-other-document', { docref: res.detail }) : await notFoundMessage(env, query, res.detail));
      return null;
    }
    let match = res.matches[0] as Match;
    if (res.matches.length > 1) {
      const labels: string[] = [];
      for (const m of res.matches) {
        const l = m.unit ? unitLabel(m.unit) : { physical: null, printed: null };
        labels.push(
          l.printed === null
            ? await t('spdf-choice-page-unnumbered', { physical: l.physical ?? '?' })
            : await t('spdf-choice-page', { physical: l.physical ?? '?', printed: l.printed }),
        );
      }
      const folio = query.kind === 'printed' ? query.value : (match.unit?.printed ?? '');
      const i = ui.select(title, await t('spdf-choose-page', { folio }), labels);
      if (i === null || !res.matches[i]) return null;
      match = res.matches[i] as Match;
    }
    const c = citationFor(doc, match, env.locale);
    Z.Utilities.Internal.copyTextToClipboard(c.text);
    ui.notify(await t('spdf-copied'), c.citation);
    return c;
  } finally {
    await doc.close();
  }
}
