import type { RawFinding, Rule } from "../types.js";
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
  version: "0.1.0",
  description: "Python imports added in the diff whose package is not declared in any dependency manifest.",
  run(ctx) {
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
            message: `Imports \`${mod}\`, not declared in ${where}`,
            locations: [{ path: file.path, line: l.newLine }],
            evidence: l.text.trim(),
          });
        }
      }
    }
    return findings;
  },
};

function candidates(mod: string): string[] {
  const n = normalizeDist(mod);
  return [n, `python-${n}`, `py${n}`, ...(KNOWN_DISTRIBUTIONS[mod] ?? [])].map(normalizeDist);
}

/**
 * Names importable from the repository itself: every directory and every
 * `.py` file stem. Broad on purpose, so a local module is never reported.
 */
function localModules(paths: string[]): Set<string> {
  const names = new Set<string>();
  for (const p of paths) {
    const parts = p.split("/");
    const file = parts.pop()!;
    parts.forEach((d) => names.add(d));
    if (file.endsWith(".py")) names.add(file.slice(0, -3));
    if (file.endsWith(".pyi")) names.add(file.slice(0, -4));
  }
  return names;
}
