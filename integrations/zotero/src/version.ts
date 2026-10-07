/** The plugin version, injected from package.json by the build (`scripts/build.mjs`). */
declare const __SPDF_ZOTERO_VERSION__: string | undefined;

export const VERSION: string = typeof __SPDF_ZOTERO_VERSION__ === 'string' ? __SPDF_ZOTERO_VERSION__ : '0.0.0-dev';
