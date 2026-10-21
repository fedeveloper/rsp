export function waitFor(fn) {
  return new Promise((r) => setTimeout(() => r(fn()), 10));
}
