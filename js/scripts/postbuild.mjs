// Marks the CLI as executable and checks its shebang survived compilation.
import { chmodSync, readFileSync } from 'node:fs';
const main = new URL('../dist/cli/main.js', import.meta.url);
if (!readFileSync(main, 'utf8').startsWith('#!/usr/bin/env node')) throw new Error('dist/cli/main.js lost its shebang');
chmodSync(main, 0o755);
