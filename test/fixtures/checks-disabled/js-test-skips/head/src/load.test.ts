import { describe, it, expect } from 'vitest';

describe.only('load', () => {
  it.skip('parses', () => {
    expect(1).toBe(1);
  });
  xit('fails', () => {
    expect(2).toBe(2);
  });
  it.skipIf(process.platform === 'win32')('paths', () => {
    // @ts-expect-error wrong type on purpose
    expect(load(1)).toThrow();
  });
});
