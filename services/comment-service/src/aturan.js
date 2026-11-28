export function uuidValid(id) {
  const polaUUID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  return typeof id === 'string' && polaUUID.test(id);
}

export function bolehHapusKomentar(userId, pemilikId, userRole) {
  return (
    userId === pemilikId ||
    ['moderator', 'admin'].includes(userRole)
  );
}
