import type { RawFinding, Rule } from "../types.js";
import { JS_FILE, nonCodeLines } from "./js.js";
import { stringLines } from "./python.js";
import { codeSpan } from "../text.js";

// Tests, examples and documentation declare routes that no client depends on.
const NOT_SERVED = /(^|\/)(tests?|__tests__|spec|e2e|examples?|docs?|fixtures?|benchmarks?|demo)\/|(^|\/)(test_[^/]*|[^/]*_test)\.py$|\.(test|spec)\.[cm]?[jt]sx?$/;

const PY_DECORATOR = /^\s*@\s*[A-Za-z_][\w.]*\.(route|get|post|put|patch|delete|head|options|websocket|api_route)\s*\(\s*[rRbBuU]?(["'])(\/[^"']*)\2([^)]*)/;
const DJANGO_PATH = /^\s*(?:path|re_path)\s*\(\s*[rR]?(["'])([^"']*)\1\s*,/;
// Only receivers that are conventionally servers or routers: `axios.get("/x", config)` is a request, not a route.
const JS_ROUTE = /(?:^|[^\w$.])(app|router|server|fastify|api|routes?|[A-Za-z_$][\w$]*(?:Router|App|Server))\s*\.\s*(get|post|put|patch|delete|head|options|all)\s*\(\s*(["'`])(\/[^"'`$]*)\3\s*,/;

interface Route {
  method: string;
  path: string;
  /** The path with every parameter written as `{}`, so renaming or typing a parameter is no change. */
  shape: string;
}

/** Routes a source line declares with a literal path. */
function routesOn(line: string, file: string): Route[] {
  const make = (method: string, path: string): Route => ({
    method,
    path,
    shape: `${method} ${path.replace(/<[^>]+>|\{[^}]+\}|:[A-Za-z_$][\w$]*(\([^)]*\))?\??/g, "{}")}`,
  });
  if (file.endsWith(".py")) {
    const m = PY_DECORATOR.exec(line);
    if (m) {
      const [, kind, , path, rest] = m;
      if (kind === "route" || kind === "api_route") {
        const methods = /methods\s*=\s*[[(]([^\])]*)[\])]/.exec(rest!);
        // Without a literal list, the methods are unknown; Flask's default is GET.
        if (/methods\s*=/.test(rest!) && !methods) return [];
        const list = methods ? [...methods[1]!.matchAll(/["'](\w+)["']/g)].map((x) => x[1]!.toUpperCase()) : ["GET"];
        return list.map((method) => make(method, path!));
      }
      return [make(kind === "websocket" ? "WEBSOCKET" : kind!.toUpperCase(), path!)];
    }
    const d = /(^|\/)urls\.py$/.test(file) ? DJANGO_PATH.exec(line) : null;
    return d ? [make("ANY", `/${d[2]!.replace(/^\^?\/?/, "")}`)] : [];
  }
  const m = JS_ROUTE.exec(line);
  return m ? [make(m[2]!.toUpperCase(), m[4]!)] : [];
}

export const interfaceRoutes: Rule = {
  id: "interface/route-removed",
  version: "0.1.0",
  keys: "the method and path as written, e.g. `GET /items/:id`",
  description:
    "HTTP routes declared with a literal path (Flask, FastAPI, Django, Express, Fastify and similar routers) that the " +
    "diff removes, or whose method it changes, and that no file declares at head. Tests and examples are left out.",
  run(ctx) {
    const isSource = (p: string) => (p.endsWith(".py") || (JS_FILE.test(p) && !/\.(vue|svelte)$/.test(p))) && !NOT_SERVED.test(p);
    const removed: { file: string; route: Route; evidence: string }[] = [];
    for (const file of ctx.files) {
      if (file.binary || file.status === "added" || !isSource(file.oldPath)) continue;
      const before = ctx.readBase(file.oldPath) ?? "";
      const nonCode = file.oldPath.endsWith(".py") ? stringLines(before) : nonCodeLines(before);
      for (const l of file.lines) {
        if (l.kind !== "del" || nonCode.has(l.oldLine!)) continue;
        for (const route of routesOn(l.text, file.oldPath)) removed.push({ file: file.path, route, evidence: l.text.trim() });
      }
    }
    if (removed.length === 0) return [];

    // Every route declared at head, wherever it is: a route moved to another file is still served.
    const served = new Set<string>();
    for (const path of ctx.listHead()) {
      if (!isSource(path)) continue;
      const text = ctx.readHead(path) ?? "";
      const nonCode = path.endsWith(".py") ? stringLines(text) : nonCodeLines(text);
      text.split("\n").forEach((line, i) => {
        if (!nonCode.has(i + 1)) for (const r of routesOn(line, path)) served.add(r.shape);
      });
    }

    const findings: RawFinding[] = [];
    const seen = new Set<string>();
    for (const { file, route, evidence } of removed) {
      const key = `${route.method} ${route.path}`;
      if (served.has(route.shape) || seen.has(`${file}\0${key}`)) continue;
      seen.add(`${file}\0${key}`);
      findings.push({
        key,
        message: `Removed route ${codeSpan(key)}; no file declares it at head`,
        locations: [{ path: file }],
        evidence,
      });
    }
    return findings;
  },
};
