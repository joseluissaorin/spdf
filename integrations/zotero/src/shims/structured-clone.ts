/**
 * `structuredClone` for the bundle. Zotero's plugin sandbox is created with a fixed
 * list of web globals (`chrome/content/zotero/xpcom/plugins.js`) that does not include
 * `structuredClone`, and `spdf-format` uses it to copy CSL-JSON metadata before
 * exporting it. esbuild injects this module wherever the bundle names
 * `structuredClone` (see `scripts/build.mjs`): the native function when the scope has
 * one, otherwise a JSON round trip, which is exact for what the library clones
 * (metadata parsed from JSON).
 */

const native: (<T>(value: T) => T) | undefined =
  typeof (globalThis as { structuredClone?: unknown }).structuredClone === 'function'
    ? (globalThis as unknown as { structuredClone: <T>(value: T) => T }).structuredClone
    : undefined;

function jsonClone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

export { jsonClone as structuredCloneFallback };

export const structuredClone: <T>(value: T) => T = native ?? jsonClone;
