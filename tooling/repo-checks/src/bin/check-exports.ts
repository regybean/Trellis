/**
 * `pnpm check:exports` — the package `exports` convention gate (ADR 0015).
 *
 * Usage:
 *   tsx src/bin/check-exports.ts [repo-root]
 */
import { reportAndExit, resolveRoot } from '@acme/workspace-graph';

import { checkExports, EXPORTS_HELP, isGoverned } from '../exports';
import { packageIo } from '../io';

const io = packageIo(resolveRoot(process.argv.slice(2)));
const violations = checkExports(io);
const governed = io.packages().filter((pkg) => isGoverned(pkg.rel));

reportAndExit({
  name: 'check-exports',
  violations,
  summary: `check-exports: ${governed.length} runtime package${governed.length === 1 ? '' : 's'} — every exports map conforms.`,
  help: EXPORTS_HELP,
});
