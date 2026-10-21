// Writes the licenses of runtime dependencies bundled into action-dist/index.js.
import { readFileSync, writeFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const sections = Object.keys(pkg.dependencies ?? {})
  .sort()
  .map((name) => {
    const dep = JSON.parse(readFileSync(`node_modules/${name}/package.json`, "utf8"));
    const license = readFileSync(`node_modules/${name}/LICENSE`, "utf8").trim();
    return `${name}@${dep.version} (${dep.license})\n\n${license}\n`;
  });
writeFileSync("action-dist/THIRD_PARTY_NOTICES", `${sections.join("\n---\n\n")}`);
