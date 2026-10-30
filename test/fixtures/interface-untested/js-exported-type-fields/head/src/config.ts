export interface Settings {
  host: string;
  debug?: boolean;
  retries: number;
  timeout: number;
  label?: string;
}

export type Options = {
  verbose?: boolean;
  /** Output folder. */
  out: string;
  color?: "auto" | "never";
};

export interface Extended extends Base {
  a: string;
}

export interface Base {
  id: string;
}

export interface Dict {
  [key: string]: string;
  name: string;
}

export type Union = { a: string } | { b: string; c: string };

interface Internal {
  y: string;
}

export function load(path: string): Settings {
  return { host: path, retries: 0, timeout: 1 };
}
