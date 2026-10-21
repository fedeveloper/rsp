/**
 * A Markdown code span that holds `s` verbatim, whatever it contains. Messages
 * quote names taken from the diff (packages, variables, test ids, parameters),
 * and a name with backticks must not end the span and turn the rest into
 * Markdown or HTML in the pull request comment.
 */
export function codeSpan(s: string): string {
  const text = s.replace(/[\r\n]+/g, " ");
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  const fence = "`".repeat(longest + 1);
  const pad = text.startsWith("`") || text.endsWith("`") || (text.startsWith(" ") && text.endsWith(" ") && text.trim()) ? " " : "";
  return `${fence}${pad}${text}${pad}${fence}`;
}
