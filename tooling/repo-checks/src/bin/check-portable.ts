/**
 * `pnpm check:portable` — the portable-reference gate.
 *
 * **Report-only for now.** The repo carries a backlog of bare ADR numbers and
 * issue references that predates the rules, so every violation is downgraded to
 * a warning and the run exits 0. The sweep that clears the backlog deletes the
 * downgrade below and passes `violations` straight through, at which point the
 * rules fail `lint` — which is the whole point of landing them early: the count
 * is reviewable before 500 edits are made in its name.
 *
 * Usage:
 *   tsx src/bin/check-portable.ts [repo-root] [--all]
 */
import {
  collectViolations,
  reportAndExit,
  resolveRoot,
} from '@acme/workspace-graph';

import { repoIo } from '../io';
import { checkPortable, PORTABLE_HELP } from '../portable';

/** How many violations a report-only run lists before it summarises the rest. */
const LISTED = 20;

const args = process.argv.slice(2);
const { violations, scanned } = checkPortable(repoIo(resolveRoot(args)));
const found = violations.errors.length;

// The downgrade. Capped, because it is read on every `lint`; `--all` prints the
// backlog in full, which is what reviewing the rules needs.
const shown = args.includes('--all')
  ? violations.errors
  : violations.errors.slice(0, LISTED);
const reported = collectViolations();
for (const error of shown) reported.warn(error);
if (found > shown.length) {
  reported.warn(
    `…and ${found - shown.length} more. Run \`pnpm check:portable --all\` to see them.`,
  );
}

reportAndExit({
  name: 'check-portable',
  violations: reported,
  summary:
    found === 0
      ? `check-portable: ${scanned} files carry no reference that only resolves here.`
      : `check-portable: ${found} non-portable references across ${scanned} files — ` +
        `reporting only, not failing lint yet. ${PORTABLE_HELP}`,
});
