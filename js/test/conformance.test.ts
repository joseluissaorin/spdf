import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runConformance } from '../src/conformance.js';
import { nodeEngine } from '../src/entry/node.js';
import { wasmEngine } from '../src/adapters/wasm.js';

const dir = fileURLToPath(new URL('../../conformance/', import.meta.url));
const present = existsSync(`${dir}/cases`);

describe.runIf(present)('shared conformance suite', () => {
  it.each([
    ['node:sqlite', nodeEngine()],
    ['sqlite-wasm', wasmEngine()],
  ] as const)('passes every case with %s', async (_name, engine) => {
    const r = await runConformance(dir, { engine });
    expect(r.failed).toEqual([]);
    expect(r.skipped).toEqual([]);
    expect(r.passed.length).toBeGreaterThanOrEqual(220);
  });
});
