import { z } from 'zod/v4';

/**
 * Coercion-tolerant leaf schemas for config authors (ADR 0033).
 *
 * Every overridable scalar must accept the *string* an environment variable
 * hands over as well as the typed literal a profile authors — `pnpm lint` fails
 * a leaf that doesn't (`scripts/check-config-overrides.ts`). Numbers get there
 * with plain `z.coerce.number()`; booleans need this helper.
 */

/**
 * A boolean a profile can author as `false` and an operator can override with
 * `BOOL=false`.
 *
 * Not `z.coerce.boolean()`: that is JavaScript truthiness, so the string
 * `'false'` coerces to `true` — an override that reads as if it disabled
 * something and silently enabled it. `z.stringbool()` parses the intended
 * spellings (`true/false`, `1/0`, `yes/no`, `on/off`) but rejects a real
 * boolean, which is what profiles author; the union accepts both and outputs
 * `boolean` either way.
 */
export const coercedBoolean = () => z.union([z.boolean(), z.stringbool()]);
