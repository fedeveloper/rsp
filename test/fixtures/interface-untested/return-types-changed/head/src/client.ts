export function fetchUser(id: string): Promise<User | null> {
  return get(id);
}

export const parse = (text: string): number => Number(text.trim());

export class Client {
  close(): Promise<void> {
    return Promise.resolve();
  }
}
