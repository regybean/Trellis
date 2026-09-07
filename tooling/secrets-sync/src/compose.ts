/**
 * The two directions of the sync, as pure functions over records.
 *
 * Pull composes the environment a file *should* hold: non-secret values from
 * the example, secret values from the vault. Push reduces a filled file to just
 * the part the vault is allowed to hold. Both are driven by the example, so
 * non-secret config never leaves the repo and secrets never enter it.
 */
import type { EnvRecord } from './dotenv';
import { isSecretKey } from './classify';

/**
 * The environment a `.env` should hold: every key the example declares, in
 * example order, with secrets filled from the vault.
 *
 * A secret the vault does not hold yet composes to empty — the same thing the
 * example says — rather than being dropped, so the key still appears in the
 * file for someone to fill in.
 */
export function composeDesired({
  example,
  vault,
}: {
  example: EnvRecord;
  vault: EnvRecord;
}): EnvRecord {
  const desired: EnvRecord = {};
  for (const [key, exampleValue] of Object.entries(example)) {
    desired[key] = isSecretKey(key, example)
      ? (vault[key] ?? '')
      : exampleValue;
  }
  return desired;
}

/** What `sensitiveOnly` found: the payload to push, and what it refused to. */
export interface SensitivePayload {
  /** The secret keys and their local values, in local file order. */
  payload: EnvRecord;
  /** Local keys the example does not declare — skipped, never pushed. */
  undeclared: string[];
}

/**
 * Reduce a filled env file to the keys the vault may hold.
 *
 * A key the example does not declare is reported rather than pushed: the
 * example is authoritative about what exists, so an undeclared key is either a
 * local experiment or a key someone forgot to declare, and guessing which one
 * by pushing it is how non-secret config ends up in a vault.
 */
export function sensitiveOnly({
  example,
  local,
}: {
  example: EnvRecord;
  local: EnvRecord;
}): SensitivePayload {
  const payload: EnvRecord = {};
  const undeclared: string[] = [];
  for (const [key, value] of Object.entries(local)) {
    if (!(key in example)) {
      undeclared.push(key);
      continue;
    }
    if (isSecretKey(key, example)) payload[key] = value;
  }
  return { payload, undeclared };
}
