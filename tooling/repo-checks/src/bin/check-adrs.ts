/**
 * `pnpm check:adrs` — the ADR hygiene gate.
 *
 * Usage:
 *   tsx src/bin/check-adrs.ts [repo-root]
 */
import { reportAndExit, resolveRoot } from '@acme/workspace-graph';

import { ADRS_HELP, checkAdrs } from '../adrs';
import { repoIo } from '../io';

const { violations, directories, total } = checkAdrs(
  repoIo(resolveRoot(process.argv.slice(2))),
);

const count = directories.length;
const plural = count === 1 ? 'directory' : 'directories';

reportAndExit({
  name: 'check-adrs',
  violations,
  summary: `check-adrs: ${total} ADRs across ${count} ${plural} — numbering, statuses, links and map rows all clean.`,
  help: ADRS_HELP,
});
