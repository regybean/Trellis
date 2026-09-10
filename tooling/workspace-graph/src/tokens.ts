/**
 * Turning a CLI token into a workspace package.
 *
 * "Short name" has to mean the same thing to `pnpm dev <app>` as it does to
 * `pnpm test:inventory <app>`, so the rule lives here once rather than in each
 * command that takes a package argument.
 */
import path from 'node:path';

import type { WorkspacePackage } from './workspace';

/**
 * The package a CLI token names, or `undefined` when none does.
 *
 * A token may be the full name (`@acme/web`), the unscoped tail (`web`), or the
 * directory (`web-slim`). The tail is matched against the scope actually
 * present rather than a hardcoded `@acme/`, so a renamed scope needs no change
 * here.
 *
 * @throws when the token is a tail two packages share — silently picking one is
 * the failure mode worth ruling out.
 */
export function matchToken(
  token: string,
  packages: readonly WorkspacePackage[],
): WorkspacePackage | undefined {
  const exact = packages.find((pkg) => pkg.name === token);
  if (exact) return exact;

  const candidates = packages.filter(
    (pkg) => pkg.name.endsWith(`/${token}`) || path.basename(pkg.dir) === token,
  );
  if (candidates.length > 1) {
    const names = candidates.map((pkg) => pkg.name).join(', ');
    throw new Error(`"${token}" is ambiguous — it could mean ${names}`);
  }
  return candidates[0];
}

/**
 * The package a CLI token names.
 *
 * @param what What to call the thing when the token names none — `app` for a
 * command that only takes apps, so the refusal says what was expected.
 * @throws when the token names nothing, or two things.
 */
export function resolveToken(
  token: string,
  packages: readonly WorkspacePackage[],
  what = 'package',
): WorkspacePackage {
  const match = matchToken(token, packages);
  if (!match) throw new Error(`unknown ${what} "${token}"`);
  return match;
}
