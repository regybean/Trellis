/**
 * `pnpm check:imports` — the undeclared-import gate (../imports.ts).
 *
 * Usage:
 *   tsx src/bin/check-imports.ts [repo-root]
 */
import { reportAndExit, resolveRoot } from '@acme/workspace-graph';

import { checkImports, IMPORTS_HELP } from '../imports';
import { packageIo } from '../io';

const io = packageIo(resolveRoot(process.argv.slice(2)));
const violations = checkImports(io);
const count = io.packages().length;

reportAndExit({
  name: 'check-imports',
  violations,
  summary: `check-imports: ${count} package${count === 1 ? '' : 's'} — every external import is declared by the package that makes it.`,
  help: IMPORTS_HELP,
});
