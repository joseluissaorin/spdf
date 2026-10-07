/** `spdf-format` on Node: `node:sqlite` (Node ≥ 22.5) and `node:zlib`. */
import { setDefaultEngine } from '../port.js';
import { nodeEngine } from '../adapters/node.js';

setDefaultEngine(nodeEngine());

export * from '../index.js';
export { nodeEngine, type NodeEngineOptions } from '../adapters/node.js';
