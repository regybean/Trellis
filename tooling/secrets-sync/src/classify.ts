/**
 * Which keys are secret. `<file>.example` is the contract
 * ([ADR 0001](../docs/adr/0001-pluggable-secrets-sync.md)): it declares every
 * key the file may hold, and a key's emptiness there declares its sensitivity.
 *
 * Pull and push both ask this module, so the two directions cannot drift into
 * disagreeing about what a secret is.
 */
import type { EnvRecord } from './dotenv';

/**
 * A `NEXT_PUBLIC_*` key reaches the browser bundle, so it is never a secret
 * however empty the example leaves it.
 */
const PUBLIC_PREFIX = 'NEXT_PUBLIC_';

/**
 * A key is secret exactly when the example declares it empty and it is not
 * publicly prefixed. A key the example does not declare is not secret, because
 * the example is the only thing that could have said so.
 */
export function isSecretKey(key: string, example: EnvRecord): boolean {
  return !key.startsWith(PUBLIC_PREFIX) && example[key] === '';
}

/** The example's secret keys, in example order. */
export function secretKeys(example: EnvRecord): string[] {
  return Object.keys(example).filter((key) => isSecretKey(key, example));
}
