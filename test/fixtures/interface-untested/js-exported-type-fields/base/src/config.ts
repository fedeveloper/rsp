export interface Settings {
  host: string;
  port: number;
  debug?: boolean;
  retries?: number;
}

export type Options = {
  verbose?: boolean;
  /** Output folder. */
  out: string;
};

export interface Extended extends Base {
  a: string;
  b: string;
}

export interface Base {
  id: string;
}

export interface Dict {
  [key: string]: string;
}

export type Union = { a: string } | { b: string };

interface Internal {
  x: string;
}

export function load(path: string): Settings {
  return { host: path, port: 1 };
}
