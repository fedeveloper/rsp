export function fetchUser(id: string): Promise<User> {
  return get(`/users/${id}`);
}

export const remove = async (id: string) => {
  await del(id);
};

export const client = make(1);
