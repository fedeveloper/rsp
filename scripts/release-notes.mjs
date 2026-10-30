// Prints the CHANGELOG.md section of one version, the body of its GitHub Release.
// Usage: node scripts/release-notes.mjs 0.5.0
import { readFileSync } from "node:fs";

const version = process.argv[2]?.replace(/^v/, "");
if (!version) {
  console.error("usage: node scripts/release-notes.mjs <version>");
  process.exit(2);
}
const lines = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8").split("\n");
const start = lines.findIndex((l) => l.startsWith(`## [${version}] - `));
if (start < 0) {
  console.error(`CHANGELOG.md has no section for ${version}`);
  process.exit(1);
}
const end = lines.findIndex((l, i) => i > start && /^(## |\[[^\]]+\]: )/.test(l));
console.log(lines.slice(start + 1, end < 0 ? undefined : end).join("\n").trim());
