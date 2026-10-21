import type { FileChange } from "./types.js";

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/**
 * Parses the output of `git diff` (any context size) into per-file changes.
 * Expects the default `a/` and `b/` prefixes.
 */
export function parseUnifiedDiff(text: string): FileChange[] {
  const files: FileChange[] = [];
  let current: FileChange | undefined;
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;

  for (const raw of text.split("\n")) {
    if (raw.startsWith("diff --git ")) {
      const [oldPath, newPath] = splitGitHeader(raw.slice("diff --git ".length));
      current = { path: newPath, oldPath, status: "modified", binary: false, lines: [] };
      files.push(current);
      inHunk = false;
      continue;
    }
    if (!current) continue;

    if (inHunk) {
      if (raw.startsWith("+")) {
        current.lines.push({ kind: "add", text: raw.slice(1), newLine: newLine++ });
        continue;
      }
      if (raw.startsWith("-")) {
        current.lines.push({ kind: "del", text: raw.slice(1), oldLine: oldLine++ });
        continue;
      }
      if (raw.startsWith(" ")) {
        oldLine++;
        newLine++;
        continue;
      }
      if (raw.startsWith("\\")) continue; // "\ No newline at end of file"
      inHunk = false;
    }

    const hunk = HUNK_HEADER.exec(raw);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      inHunk = true;
    } else if (raw.startsWith("new file mode")) {
      current.status = "added";
    } else if (raw.startsWith("deleted file mode")) {
      current.status = "deleted";
    } else if (raw.startsWith("rename from ")) {
      current.status = "renamed";
      current.oldPath = unquote(raw.slice("rename from ".length));
    } else if (raw.startsWith("rename to ")) {
      current.status = "renamed";
      current.path = unquote(raw.slice("rename to ".length));
    } else if (raw.startsWith("Binary files ")) {
      current.binary = true;
    } else if (raw.startsWith("--- ")) {
      const p = raw.slice(4);
      if (p !== "/dev/null") current.oldPath = stripPrefix(unquote(p), "a/");
    } else if (raw.startsWith("+++ ")) {
      const p = raw.slice(4);
      if (p !== "/dev/null") current.path = stripPrefix(unquote(p), "b/");
    }
  }

  for (const f of files) {
    if (f.status === "deleted") f.path = f.oldPath;
  }
  return files;
}

function splitGitHeader(rest: string): [string, string] {
  if (rest.startsWith('"')) {
    const end = closingQuote(rest);
    const oldPath = unquote(rest.slice(0, end + 1));
    const newPath = unquote(rest.slice(end + 2));
    return [stripPrefix(oldPath, "a/"), stripPrefix(newPath, "b/")];
  }
  // Unquoted "a/X b/Y": when X === Y the split point is the middle.
  const half = (rest.length - 1) / 2;
  if (Number.isInteger(half) && rest[half] === " ") {
    const oldPath = rest.slice(0, half);
    const newPath = rest.slice(half + 1);
    if (oldPath.slice(2) === newPath.slice(2)) {
      return [stripPrefix(oldPath, "a/"), stripPrefix(newPath, "b/")];
    }
  }
  const idx = rest.indexOf(" b/");
  return [stripPrefix(rest.slice(0, idx), "a/"), stripPrefix(rest.slice(idx + 1), "b/")];
}

function closingQuote(s: string): number {
  for (let i = 1; i < s.length; i++) {
    if (s[i] === "\\") i++;
    else if (s[i] === '"') return i;
  }
  return s.length - 1;
}

const ESCAPES: Record<string, string> = { n: "\n", t: "\t", '"': '"', "\\": "\\" };

/** Undoes git's C-style quoting of paths with special characters. */
function unquote(p: string): string {
  if (!p.startsWith('"') || !p.endsWith('"')) return p;
  const body = p.slice(1, -1);
  const bytes: number[] = [];
  for (let i = 0; i < body.length; i++) {
    const c = body[i]!;
    if (c !== "\\") {
      bytes.push(...Buffer.from(c, "utf8"));
      continue;
    }
    const next = body[++i]!;
    if (/[0-7]/.test(next)) {
      bytes.push(parseInt(body.slice(i, i + 3), 8));
      i += 2;
    } else {
      bytes.push(...Buffer.from(ESCAPES[next] ?? next, "utf8"));
    }
  }
  return Buffer.from(bytes).toString("utf8");
}

function stripPrefix(p: string, prefix: string): string {
  return p.startsWith(prefix) ? p.slice(prefix.length) : p;
}
