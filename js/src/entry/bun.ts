/** `spdf-format` on Bun: `bun:sqlite`. */
import { setDefaultEngine } from '../port.js';
import { bunEngine } from '../adapters/bun.js';

setDefaultEngine(bunEngine());

export * from '../index.js';
export { bunEngine } from '../adapters/bun.js';
