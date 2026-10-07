// Writes src/manifest.ts from models/manifest.json (the package ships its own copy, as a module,
// so it loads in browsers and Node without JSON import attributes); --check fails on drift.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url)); // not URL.pathname: it breaks on Windows drive letters
const src = path.join(here, "..", "..", "manifest.json");
const dst = path.join(here, "..", "src", "manifest.ts");
const json = JSON.parse(fs.readFileSync(src, "utf8"));
const text = `// Generated from models/manifest.json by scripts/sync-manifest.mjs. Do not edit.\nexport default ${JSON.stringify(json, null, 1)};\n`;
if (process.argv.includes("--check")) {
  const cur = fs.existsSync(dst) ? fs.readFileSync(dst, "utf8") : "";
  if (cur !== text) { console.error("src/manifest.ts is out of date: npm run sync-manifest"); process.exit(1); }
  console.log("manifest in sync");
} else {
  fs.writeFileSync(dst, text);
}
