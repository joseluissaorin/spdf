// Copies models/manifest.json into src/ (the package ships its own copy); --check fails on drift.
import fs from "node:fs";
import path from "node:path";
const here = path.dirname(new URL(import.meta.url).pathname);
const src = path.join(here, "..", "..", "manifest.json");
const dst = path.join(here, "..", "src", "manifest.json");
const a = fs.readFileSync(src, "utf8");
if (process.argv.includes("--check")) {
  const b = fs.existsSync(dst) ? fs.readFileSync(dst, "utf8") : "";
  if (a !== b) { console.error("src/manifest.json is out of date: npm run sync-manifest"); process.exit(1); }
  console.log("manifest in sync");
} else {
  fs.writeFileSync(dst, a);
}
