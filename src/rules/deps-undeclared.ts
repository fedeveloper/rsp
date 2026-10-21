import type { DiffContext, RawFinding, Rule } from "../types.js";
import { isInTryBlock, importedSpecifiers, JS_FILE, nonCodeLines, packageName } from "./js.js";
import { NODE_BUILTINS } from "./js-builtins.js";
import { jsManifests } from "./js-manifests.js";
import { importedModules, normalizeDist, optionalModules } from "./python.js";
import { declaredDependencies } from "./python-manifests.js";
import { PYTHON_STDLIB } from "./python-stdlib.js";

// Import names whose distribution is named differently on PyPI.
const KNOWN_DISTRIBUTIONS: Record<string, string[]> = {
  attr: ["attrs"],
  bs4: ["beautifulsoup4"],
  cv2: ["opencv-python", "opencv-python-headless", "opencv-contrib-python", "opencv-contrib-python-headless"],
  Crypto: ["pycryptodome", "pycrypto"],
  Cryptodome: ["pycryptodomex"],
  dateutil: ["python-dateutil"],
  docx: ["python-docx"],
  dotenv: ["python-dotenv"],
  fitz: ["pymupdf"],
  git: ["gitpython"],
  google: ["protobuf", "google-api-python-client", "google-cloud-storage", "google-auth"],
  jose: ["python-jose"],
  jwt: ["pyjwt"],
  magic: ["python-magic"],
  multipart: ["python-multipart"],
  MySQLdb: ["mysqlclient"],
  OpenSSL: ["pyopenssl"],
  PIL: ["pillow"],
  pptx: ["python-pptx"],
  psycopg2: ["psycopg2-binary"],
  serial: ["pyserial"],
  skimage: ["scikit-image"],
  sklearn: ["scikit-learn"],
  slugify: ["python-slugify"],
  telegram: ["python-telegram-bot"],
  websocket: ["websocket-client"],
  yaml: ["pyyaml"],
  zmq: ["pyzmq"],
};

export const depsUndeclared: Rule = {
  id: "deps/undeclared",
  version: "0.2.0",
  keys: "the imported module (Python) or package (JavaScript), e.g. `boto3`",
  description:
    "Python and JavaScript/TypeScript imports added in the diff whose package is not declared in a dependency manifest.",
  run(ctx) {
    return [...python(ctx), ...javascript(ctx)];
  },
};

function python(ctx: DiffContext): RawFinding[] {
  const pyFiles = ctx.files.filter((f) => !f.binary && f.status !== "deleted" && f.path.endsWith(".py"));
  if (pyFiles.length === 0) return [];
  const declared = declaredDependencies(ctx);
  // Without any manifest there is nothing to compare against.
  if (declared.manifests.length === 0) return [];
  const local = localModules(ctx.listHead());
  const where =
    declared.manifests.length <= 3
      ? declared.manifests.join(", ")
      : `any of ${declared.manifests.length} dependency manifests`;

  const findings: RawFinding[] = [];
  for (const file of pyFiles) {
    const optional = optionalModules((ctx.readHead(file.path) ?? "").split("\n"));
    for (const l of file.lines) {
      if (l.kind !== "add") continue;
      for (const mod of importedModules(l.text)) {
        if (PYTHON_STDLIB.has(mod) || local.has(mod) || optional.has(mod)) continue;
        if (candidates(mod).some((c) => declared.names.has(c))) continue;
        findings.push({
          key: mod,
          message: `Imports \`${mod}\`, not declared in ${where}`,
          locations: [{ path: file.path, line: l.newLine }],
          evidence: l.text.trim(),
        });
      }
    }
  }
  return findings;
}

/**
 * Packages imported in added JavaScript/TypeScript lines that no package.json
 * between the file and the repository root declares.
 */
function javascript(ctx: DiffContext): RawFinding[] {
  const jsFiles = ctx.files.filter((f) => !f.binary && f.status !== "deleted" && JS_FILE.test(f.path));
  if (jsFiles.length === 0) return [];
  const manifests = jsManifests(ctx);
  // Bare specifiers such as `components/Button` resolve to local folders under
  // a baseUrl; any name that is also a folder or file stem counts as local.
  const local = localModules(ctx.listHead());

  const findings: RawFinding[] = [];
  for (const file of jsFiles) {
    const packages = manifests.forFile(file.path);
    // A file outside every package has nothing to compare against.
    if (packages.length === 0) continue;
    const text = ctx.readHead(file.path) ?? "";
    const lines = text.split("\n");
    const nonCode = nonCodeLines(text);
    const where = packages.slice(0, 3).map((p) => p.path).join(", ");
    for (const l of file.lines) {
      if (l.kind !== "add" || nonCode.has(l.newLine!)) continue;
      for (const spec of importedSpecifiers(l.text)) {
        const name = packageName(spec);
        if (!name || NODE_BUILTINS.has(name) || NODE_BUILTINS.has(spec) || local.has(name)) continue;
        if (manifests.local.has(name) || manifests.aliases.some((a) => spec === a || (a.endsWith("/") && spec.startsWith(a)))) continue;
        if (packages.some((p) => p.names.has(name) || p.names.has(typesPackage(name)))) continue;
        if (isInTryBlock(lines, l.newLine! - 1)) continue;
        findings.push({
          key: name,
          message: `Imports \`${name}\`, not declared in ${where}`,
          locations: [{ path: file.path, line: l.newLine }],
          evidence: l.text.trim(),
        });
      }
    }
  }
  return findings;
}

/** DefinitelyTyped name: `@types/node`, `@types/babel__core` for `@babel/core`. */
function typesPackage(name: string): string {
  return `@types/${name.startsWith("@") ? name.slice(1).replace("/", "__") : name}`;
}

function candidates(mod: string): string[] {
  const n = normalizeDist(mod);
  return [n, `python-${n}`, `py${n}`, ...(KNOWN_DISTRIBUTIONS[mod] ?? [])].map(normalizeDist);
}

/**
 * Names importable from the repository itself: every directory and every
 * Python or JavaScript file stem. Broad on purpose, so a local module is never reported.
 */
function localModules(paths: string[]): Set<string> {
  const names = new Set<string>();
  for (const p of paths) {
    const parts = p.split("/");
    const file = parts.pop()!;
    parts.forEach((d) => names.add(d));
    if (file.endsWith(".py")) names.add(file.slice(0, -3));
    if (file.endsWith(".pyi")) names.add(file.slice(0, -4));
    const js = /^(.+)\.(js|jsx|mjs|cjs|ts|tsx|mts|cts)$/.exec(file);
    if (js) names.add(js[1]!);
  }
  return names;
}
