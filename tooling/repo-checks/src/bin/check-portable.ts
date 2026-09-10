/**
 * `pnpm check:portable` — the portable-reference gate.
 *
 * A hard failure: a bare ADR number, a citation resolving outside the citing
 * package, an issue reference or a root ADR naming an app fails `pnpm lint`. It
 * landed report-only first, so the count the rules produced across the whole
 * repo was reviewable — and the rules arguable — before the sweep that cleared
 * it was made in their name.
 *
 * Usage: tsx src/bin/check-portable.ts [repo-root]
 */
import { reportAndExit, resolveRoot } from '@acme/workspace-graph';

import { repoIo } from '../io';
import { checkPortable, PORTABLE_HELP } from '../portable';

const { violations, scanned } = checkPortable(
  repoIo(resolveRoot(process.argv.slice(2))),
);

reportAndExit({
  name: 'check-portable',
  violations,
  help: PORTABLE_HELP,
  summary: `check-portable: ${scanned} files carry no reference that only resolves here.`,
});
