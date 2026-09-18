export class PromoCodeConflict extends Error {}

interface RequestOwner {
  id: string;
  requesterId: string;
  status: string;
}

/** An uncertain FAILED write retains ownership just like an active code. */
export function chooseReservedRequest<T extends RequestOwner>(
  reserved: T | null,
  active: T[],
  requesterId: string
): T | undefined {
  if (active.length > 1 || (reserved && reserved.status !== "REJECTED_TEACHER" && active[0] && active[0].id !== reserved.id)) {
    throw new PromoCodeConflict("This code is unavailable. Try a different code.");
  }
  const owned = reserved?.status !== "REJECTED_TEACHER" ? reserved ?? active[0] : active[0];
  if (owned && owned.requesterId !== requesterId) {
    throw new PromoCodeConflict("This code is already in use or pending approval");
  }
  return owned;
}
