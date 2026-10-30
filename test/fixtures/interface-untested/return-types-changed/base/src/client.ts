export function fetchUser(id: string): Promise<User> {
  return get(id);
}

export const parse = (text: string): number => Number(text);

export class Client {
  close(): void {}
}
