export function fetchUser(
  id: string,
  opts?: { cache: boolean },
): Promise<User> {
  return get(`/users/${id}`);
}

export const remove = async (userId: string, force = false) => {
  await del(userId, force);
};

export const client = make(2);
