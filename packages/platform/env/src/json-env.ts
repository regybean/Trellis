import { z } from 'zod/v4';

/**
 * A JSON document arriving as text. Kept separate from `jsonEnv` so the failure
 * is reported as itself — `Expected JSON…` naming the variable's own path —
 * rather than as a shapeless union error.
 */
const jsonText = z.string().transform((raw, ctx) => {
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed;
  } catch {
    ctx.addIssue({
      code: 'custom',
      message: `Expected JSON, received: ${raw}`,
    });
    return z.NEVER;
  }
});

/**
 * Make a **non-scalar** key env-overridable: accept either the authored literal
 * or a JSON string, and validate both against the same schema.
 *
 * ADR 0001 §4 makes every key overridable, and an environment variable is a
 * string. `z.coerce.number()` already covers the scalar case; an array, an
 * object or a boolean has no such coercion, so `MODELS_CHAT`, `CREDIT_LIMITS`
 * and `MEMORY_SEMANTIC_RECALL` would otherwise be overridable in name only —
 * the variable would be read and then fail validation as "expected object,
 * received string".
 *
 * Booleans go through here rather than `z.coerce.boolean()`, which is JavaScript
 * truthiness: the string `'false'` coerces to `true`, so an operator disabling
 * something would have enabled it.
 *
 * Both branches are needed because both inputs are real. A profile value is fed
 * *through* the schema by `withProfiles`'s `.prefault()`, so it arrives as the
 * literal it was authored as; `process.env` arrives as text. The literal branch
 * is first so the common path — no override set — is also the first one tried.
 *
 * The union is what preserves authoring-time safety: the input type
 * stays `string | z.input<TSchema>`, so a mis-shaped profile literal still fails
 * to match either branch and is a compile error on the literal. A `z.preprocess`
 * would read better but widens the input to `unknown`, which would silently
 * retire that guarantee for exactly the most structured keys in the tree.
 */
export function jsonEnv<TSchema extends z.ZodType>(schema: TSchema) {
  return z.union([schema, jsonText.pipe(schema)]);
}
