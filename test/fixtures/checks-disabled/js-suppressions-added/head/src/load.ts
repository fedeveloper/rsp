// @ts-nocheck
export function load(data) {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return JSON.parse(data); // @ts-ignore
}
/* istanbul ignore next */
export function debug(x) {
  // @ts-expect-error legacy
  // biome-ignore lint/suspicious/noConsole: debugging
  console.log(x);
}
// Do not add eslint-disable here.
