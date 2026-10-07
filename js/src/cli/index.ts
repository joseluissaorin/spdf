/**
 * `spdf-format` command line (Node ≥ 22.5):
 *
 *   spdf-format validate <file|url> [--json]
 *   spdf-format dump <file|url> [--pretty]
 *   spdf-format search <file|url> <query> [--limit N] [--space ID --vector JSON|@file]
 *   spdf-format cite <file|url> <fragment-id|anchor-uri> [--locale es|en] | --csl | --bibtex
 *   spdf-format convert <legacy.spdf> <out.spdf>
 *   spdf-format info <file|url>
 *   spdf-format conformance [dir]
 */

import { readFile, writeFile } from 'node:fs/promises';
import {
  VERSION,
  canonicalJson,
  convertLegacy,
  dump,
  locatorToAnchor,
  openSpdf,
  parseAnchorUri,
  toBibtex,
  toCslJson,
  validate,
  type SpdfDocument,
  type SpdfInput,
} from '../entry/node.js';
import { runConformance } from '../conformance.js';

const HELP = `spdf-format ${VERSION}: SPDF 5.0 tools

Usage:
  spdf-format validate <file|url> [--json]
  spdf-format dump <file|url> [--pretty]
  spdf-format search <file|url> <query> [--limit N] [--space ID --vector JSON|@file.json]
  spdf-format cite <file|url> <fragment-id|anchor-uri> [--locale es|en]
  spdf-format cite <file|url> --csl | --bibtex
  spdf-format convert <legacy-4.x.spdf> <out.spdf> [--hash]
  spdf-format info <file|url>
  spdf-format conformance [conformance-dir] [--only ID]

Exit status: 0 ok, 1 invalid file or failed cases, 2 usage error.
`;

interface Parsed {
  positional: string[];
  flags: Map<string, string | true>;
}

function parseArgs(args: string[]): Parsed {
  const positional: string[] = [];
  const flags = new Map<string, string | true>();
  const valued = new Set(['--limit', '--space', '--vector', '--locale', '--only']);
  for (let i = 0; i < args.length; i++) {
    const a = args[i] as string;
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) flags.set(a.slice(0, eq), a.slice(eq + 1));
      else if (valued.has(a) && i + 1 < args.length) flags.set(a, args[++i] as string);
      else flags.set(a, true);
    } else positional.push(a);
  }
  return { positional, flags };
}

async function input(arg: string): Promise<SpdfInput> {
  if (/^https?:\/\//i.test(arg)) {
    const res = await fetch(arg);
    if (!res.ok) throw new Error(`GET ${arg}: HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }
  return arg;
}

type Out = (s: string) => void;

export async function main(args: string[], out: Out = (s) => process.stdout.write(s), errOut: Out = (s) => process.stderr.write(s)): Promise<number> {
  const { positional, flags } = parseArgs(args);
  const [cmd, ...rest] = positional;
  if (!cmd || flags.has('--help') || cmd === 'help') {
    out(HELP);
    return cmd ? 0 : 2;
  }
  if (flags.has('--version') || cmd === 'version') {
    out(`${VERSION}\n`);
    return 0;
  }
  try {
    switch (cmd) {
      case 'validate': {
        const file = rest[0];
        if (!file) return usage(errOut);
        const r = await validate(await input(file));
        if (flags.has('--json')) out(`${JSON.stringify(r, null, 2)}\n`);
        else {
          out(`${r.valid ? 'valid' : 'INVALID'} SPDF ${r.version ?? '?'}${r.profile.length ? ` (${r.profile.join(' ')})` : ''}\n`);
          for (const e of r.errors) out(`  error   ${e.code} ${e.message}${e.where ? ` [${e.where}]` : ''}\n`);
          for (const w of r.warnings) out(`  warning ${w.code} ${w.message}${w.where ? ` [${w.where}]` : ''}\n`);
        }
        return r.valid ? 0 : 1;
      }
      case 'dump': {
        const file = rest[0];
        if (!file) return usage(errOut);
        const d = await dump(await input(file));
        out(flags.has('--pretty') ? `${JSON.stringify(d, null, 2)}\n` : `${canonicalJson(d)}\n`);
        return 0;
      }
      case 'search': {
        const [file, ...words] = rest;
        const query = words.join(' ');
        if (!file) return usage(errOut);
        const doc = await openSpdf(await input(file));
        try {
          const limit = Number(flags.get('--limit') ?? 10);
          const space = flags.get('--space');
          const vecArg = flags.get('--vector');
          let vector: number[] | null = null;
          if (typeof vecArg === 'string') vector = JSON.parse(vecArg.startsWith('@') ? await readFile(vecArg.slice(1), 'utf8') : vecArg) as number[];
          const hits =
            vector && typeof space === 'string'
              ? query
                ? await doc.searchHybrid(query, vector, space, { limit })
                : await doc.searchVector(space, vector, { limit })
              : await doc.searchLexical(query, { limit });
          out(`${JSON.stringify((hits as unknown as Array<Record<string, unknown>>).map(({ fragment: _f, ...h }) => h), null, 2)}\n`);
          if (!flags.has('--quiet')) {
            for (const h of hits as Array<{ fragment?: { text: string; anchor: never; anchor_end: never } }>) {
              if (h.fragment) errOut(`${doc.cite(h.fragment.anchor, String(flags.get('--locale') ?? 'es'), h.fragment.anchor_end)} ${h.fragment.text.slice(0, 160).replace(/\s+/g, ' ')}\n`);
            }
          }
          return 0;
        } finally {
          await doc.close();
        }
      }
      case 'cite': {
        const [file, ref] = rest;
        if (!file) return usage(errOut);
        const doc = await openSpdf(await input(file));
        try {
          if (flags.has('--csl')) {
            out(`${JSON.stringify([toCslJson(doc.document)], null, 2)}\n`);
            return 0;
          }
          if (flags.has('--bibtex')) {
            out(toBibtex(doc.document));
            return 0;
          }
          if (!ref) return usage(errOut);
          const locale = String(flags.get('--locale') ?? 'es');
          if (ref.startsWith('spdf:')) {
            const { locator } = parseAnchorUri(ref);
            const { anchor, anchor_end } = locatorToAnchor(locator);
            out(`${doc.cite(anchor, locale, anchor_end)}\n`);
            return 0;
          }
          const f = await doc.fragment(ref);
          if (!f) {
            errOut(`No fragment with id ${ref}\n`);
            return 1;
          }
          out(`${doc.cite(f.anchor, locale, f.anchor_end)}\n${f.anchor_uri}\n`);
          return 0;
        } finally {
          await doc.close();
        }
      }
      case 'convert': {
        const [from, to] = rest;
        if (!from || !to) return usage(errOut);
        const bytes = await convertLegacy(await input(from), { contentHash: flags.has('--hash') });
        await writeFile(to, bytes);
        out(`${to}: ${bytes.byteLength} bytes, SPDF 5.0\n`);
        return 0;
      }
      case 'info': {
        const file = rest[0];
        if (!file) return usage(errOut);
        const doc: SpdfDocument = await openSpdf(await input(file));
        try {
          const spaces = await doc.spaces();
          out(
            `${JSON.stringify(
              {
                version: doc.version,
                legacy: doc.legacy,
                gzipped: doc.gzipped,
                profile: doc.profile,
                document: { id: doc.document.id, kind: doc.document.kind, title: doc.document.metadata.title, authors: doc.document.authors, year: doc.document.year },
                units: await doc.unitCount(),
                fragments: (await doc.fragments()).length,
                spaces: spaces.map((s) => `${s.id} (${s.dims} × ${s.dtype})`),
                blobs: (await doc.blobs()).length,
                citation: doc.cite({ type: 'image' }, String(flags.get('--locale') ?? 'es')),
              },
              null,
              2,
            )}\n`,
          );
          return 0;
        } finally {
          await doc.close();
        }
      }
      case 'conformance': {
        const dir = rest[0] ?? 'conformance';
        const only = flags.get('--only');
        const result = await runConformance(dir, typeof only === 'string' ? { only } : {});
        out(`${JSON.stringify(result, null, 2)}\n`);
        return result.failed.length ? 1 : 0;
      }
      default:
        errOut(`Unknown command «${cmd}».\n\n${HELP}`);
        return 2;
    }
  } catch (e) {
    errOut(`spdf-format ${cmd}: ${(e as Error).message}\n`);
    return 1;
  }
}

function usage(errOut: Out): number {
  errOut(HELP);
  return 2;
}
