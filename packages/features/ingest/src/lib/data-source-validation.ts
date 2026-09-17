// lib/data-source-validation.ts
//
// The client-side half of the Data Source name rule: reject a collision against
// the cached list BEFORE the create mutation fires.
//
// Pure and React-free so both inline-create sites — the rail row and the upload
// dialog's `＋ New data source…` option — share one rule and one message
// instead of each growing their own.
//
// Why reject rather than absorb: silently reusing a Source of the same name is
// the one outcome that must not happen. The user believes they created a fresh,
// unselected Source, while their documents land in one that may already be
// ticked in an open conversation. So the collision surfaces as a form error
// beside the name field, before any optimistic row and before any presign call.
//
// The server-side rule is rag's, and it stays: the unique index case-folds, so
// a race that beats this check is still rejected there. This check exists to
// make the common case a form error instead of a 500-shaped toast — it is not
// the enforcement.

/** Case-insensitive, trim-insensitive — the same folding rag's unique index does. */
const fold = (name: string) => name.trim().toLowerCase();

/**
 * The caller's Source of this name, if they already have one. Returns the row
 * so the message can quote the name the user already has rather than the one
 * they just typed.
 */
export function findNameCollision<T extends { name: string }>(
  sources: readonly T[],
  name: string,
) {
  const candidate = fold(name);
  if (candidate.length === 0) return undefined;
  return sources.find((source) => fold(source.name) === candidate);
}

export const collisionMessage = (existingName: string) =>
  `You already have a data source called "${existingName}".`;

/**
 * Remaining Document slots in a Source, or `undefined` while the cap is still
 * loading. Advisory: it is shown when known and omitted while pending, and it
 * never gates the upload control, because presign is the authoritative check.
 */
export function headroomFor({
  documentCount,
  cap,
}: {
  documentCount: number;
  cap: number | undefined;
}) {
  if (cap === undefined) return undefined;
  return Math.max(cap - documentCount, 0);
}
