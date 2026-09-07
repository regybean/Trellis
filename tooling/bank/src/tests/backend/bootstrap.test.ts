/**
 * The constraint that shapes this whole package: the bank runs *before*
 * `pnpm install`.
 *
 * A consumer's first contact with Trellis is hand-copying these files into a
 * repo with no `node_modules`, then running the wizard and the first sync with
 * bare `node` ([docs/bank.md](../../../../../docs/bank.md), and
 * [ADR 0001](../../../docs/adr/0001-the-bank-keeps-its-own-workspace-helpers.md)
 * for why the duplication that follows from it is deliberate). There is no
 * module resolution at that point, so a single bare specifier — a shared
 * helper, a YAML parser, anything from the workspace — breaks the bootstrap for
 * every new consumer while leaving this repo, where everything is installed,
 * perfectly green.
 *
 * That is the failure this file exists to make loud. The sibling suites already
 * run the commands from a sandbox with nothing installed, so the constraint is
 * *exercised*; what they cannot do is say why it broke. This one names it.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
// src/tests/backend -> the package's src is three levels up.
const src = resolve(here, '../../');

/** Everything a consumer hand-copies, which is every runtime file here. */
const sources = [
  'bank-sync.mjs',
  'bank-contribute.mjs',
  'setup-wizard.mjs',
  'check-bank-paths.mjs',
  'lib/bank.mjs',
  'lib/bank-closure.mjs',
];

/**
 * Every module specifier a file imports, static or dynamic. Deliberately a
 * regex over the source rather than a parse: the thing being checked is the
 * literal text a consumer copies, and a bare specifier is visible in it.
 */
function specifiers(file: string) {
  const source = readFileSync(join(src, file), 'utf8');

  return [
    ...source.matchAll(/^import\s[^'"]*['"]([^'"]+)['"]/gm),
    ...source.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g),
    ...source.matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g),
  ].flatMap((match) => match[1] ?? []);
}

describe('the bank depends on nothing that needs installing', () => {
  it.each(sources)(
    '%s imports only node builtins and its own siblings',
    (file) => {
      const offending = specifiers(file).filter(
        (specifier) =>
          !specifier.startsWith('node:') && !specifier.startsWith('./'),
      );

      expect(
        offending,
        `${file} imports ${offending.join(', ')} — a consumer runs this with bare node before any install, so there is nothing to resolve it against`,
      ).toEqual([]);
    },
  );

  it('imports at least one builtin and one sibling, so the rule is not vacuous', () => {
    const all = sources.flatMap(specifiers);

    expect(all.filter((s) => s.startsWith('node:')).length).toBeGreaterThan(0);
    expect(all.filter((s) => s.startsWith('./')).length).toBeGreaterThan(0);
  });
});
