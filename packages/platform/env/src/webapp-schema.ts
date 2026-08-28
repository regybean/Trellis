import { z } from 'zod/v4';

/**
 * `NEXT_PUBLIC_WEBAPP` — per-app identity, declared once.
 *
 * The value names a Postgres schema (`pgSchema(NEXT_PUBLIC_WEBAPP)`), the Redis
 * key namespace, and the BullMQ queue prefix, so it must be a valid Postgres
 * identifier: a lowercase letter then lowercase letters, digits or underscores —
 * no hyphens. Validating it here fails loud on a bad app name instead of
 * silently producing a broken schema or a queue one app drains from another.
 *
 * Every slice that partitions by app declares the same key, and the constraint
 * belongs to the value rather than to any one of them — so they share this
 * schema instead of each restating the regex and its message. It is a plain
 * `z.ZodType`, so a slice still owns where the key sits (`shared`, in practice)
 * and whether a profile authors it.
 */
export const webappSchema = z
  .string()
  .regex(
    /^[a-z][a-z0-9_]*$/,
    'NEXT_PUBLIC_WEBAPP must be a valid Postgres identifier: lowercase letter then lowercase/digits/underscores',
  );
