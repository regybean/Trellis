/**
 * `pnpm test:policy` — the per-package test policy gate.
 *
 * Usage:
 *   tsx src/bin/check-test-policy.ts           # enforce policy (exit 1 on violation)
 *   tsx src/bin/check-test-policy.ts --todos    # list tracked test gaps, exit 0
 *   tsx src/bin/check-test-policy.ts <root>     # check that workspace root instead
 */
import { reportAndExit, resolveRoot } from '@acme/workspace-graph';

import { composeProfilesAt } from '../infra';
import { packageIo } from '../io';
import { checkTestPolicy, TEST_POLICY_HELP } from '../test-policy';

const args = process.argv.slice(2);
const root = resolveRoot(args);
const { violations, gaps } = checkTestPolicy(
  packageIo(root),
  composeProfilesAt(root),
);

// A listing, not a gate: `--todos` reports the tracked gaps and exits zero,
// whatever else the run found.
if (args.includes('--todos')) {
  if (gaps.length === 0) {
    process.stdout.write(
      'No tracked test gaps — every library package is conforming.\n',
    );
  } else {
    process.stdout.write(`Tracked test gaps (${gaps.length}):\n\n`);
    for (const gap of [...gaps].sort((a, b) => a.name.localeCompare(b.name))) {
      process.stdout.write(
        `  • ${gap.name} [${gap.testClass}] — ${gap.reason}\n`,
      );
    }
  }
  process.exit(0);
}

const plural = gaps.length === 1 ? '' : 's';

reportAndExit({
  name: 'check-test-policy',
  violations,
  summary: `Test policy satisfied (${gaps.length} tracked gap${plural}; run \`pnpm test:policy --todos\` to list).`,
  help: TEST_POLICY_HELP,
});
