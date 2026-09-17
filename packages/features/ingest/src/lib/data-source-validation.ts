// lib/data-source-validation.ts
//
// The client-side half of the Data Source name rule, as a zod schema: forms in
// this repo use TanStack Form, and a form that hand-rolls a `useState` per field
// is a review finding rather than a style preference. So the rule goes straight
// to `validators.onDynamic` as a Standard Schema, and the collision check lives
// INSIDE validation rather than as a step sequenced before the mutation — the
// message then arrives through `field.state.meta.errors` like every other field
// error, and neither create site keeps an error slot of its own.
//
// Pure and React-free so both inline-create sites — the rail row and the upload
// dialog's `＋ New data source…` option — share one rule and one message
// instead of each growing their own.
//
// Why reject rather than absorb: silently reusing a Source of the same name is
// the one outcome that must not happen. The user believes they created a fresh,
// unselected Source, while their documents land in one that may already be
// ticked in an open conversation. So the collision surfaces as a form error
// beside the name field, before any create mutation and before any presign call.
//
// The server-side rule is rag's, and it stays: the unique index case-folds, so
// a race that beats this check is still rejected there. This check exists to
// make the common case a form error instead of a 500-shaped toast — it is not
// the enforcement.

import { z } from 'zod';

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
  if (candidate.length === 0) return;
  return sources.find((source) => fold(source.name) === candidate);
}

export const collisionMessage = (existingName: string) =>
  `You already have a data source called "${existingName}".`;

/**
 * The name field's rule, closed over the list the user currently has: blank is
 * rejected, and so is a name they already own.
 *
 * Built per render rather than declared once because the list is the rule —
 * `sources` is what a collision is measured against, and it arrives from a
 * query. Both create sites pass the result to `validators.onDynamic`, so the
 * two of them share the rule, the folding and the message.
 */
export const dataSourceNameSchema = (sources: readonly { name: string }[]) =>
  z
    .string()
    .trim()
    .min(1, 'Name your data source.')
    .superRefine((name, ctx) => {
      const clash = findNameCollision(sources, name);
      if (!clash) return;
      ctx.addIssue({ code: 'custom', message: collisionMessage(clash.name) });
    });

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
  if (cap === undefined) return;
  return Math.max(cap - documentCount, 0);
}

/**
 * The refusal when more files were chosen than the destination can take.
 *
 * Refuses the whole batch rather than admitting the files that fit, matching
 * what presign does authoritatively — partial admission would leave the user
 * reconciling which of their files made it.
 */
export const headroomMessage = (slots: number) =>
  slots === 0
    ? 'That data source is full.'
    : `That data source has room for ${slots} more document${plural(slots)}.`;

const plural = (count: number) => (count === 1 ? '' : 's');
