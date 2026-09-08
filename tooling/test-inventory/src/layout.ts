/**
 * What the vitest include globs say about where a test sits.
 *
 * The tool used to state the layout for itself — the `src/tests/` prefix in one
 * constant, the two config filenames in another — several files away from
 * `@acme/test-utils`, which actually defines what a project collects. Two
 * statements of one rule is how a report and the runner it reports on come to
 * disagree. So the globs are imported and everything else is derived from them:
 * change the layout in test-utils and this follows, or fails loudly.
 */
import type { TestLayer } from '@acme/test-utils/vitest';
import { TEST_INCLUDE, TEST_LAYERS } from '@acme/test-utils/vitest';

export type { TestLayer };
export { TEST_LAYERS };

/** The segments of a glob before its first wildcard — the directory it lives in. */
function literalPrefix(glob: string) {
  const segments = glob.split('/');
  const wildcard = segments.findIndex((segment) => segment.includes('*'));
  return wildcard === -1 ? segments : segments.slice(0, wildcard);
}

/**
 * The directory every layer's tests sit under, `src/tests`.
 *
 * Derived from the globs rather than written down again, because it is the base
 * the group heading and both filter axes are measured from: a report that
 * disagreed with the runner about where `src/tests/` is would silently file
 * every test under the wrong heading.
 *
 * @throws when a glob's directory does not end in its own layer segment, or the
 * layers do not share one root — either means the layout moved and this
 * derivation no longer describes it.
 */
export function testsDir(include: Record<TestLayer, string>) {
  const roots = TEST_LAYERS.map((layer) => {
    const prefix = literalPrefix(include[layer]);
    if (prefix.at(-1) !== layer) {
      throw new Error(
        `the ${layer} include glob (${include[layer]}) is not under a "${layer}" directory`,
      );
    }
    return prefix.slice(0, -1).join('/');
  });
  const root = roots[0];
  if (root === undefined || roots.some((other) => other !== root)) {
    throw new Error(
      `the include globs do not share one test directory: ${roots.join(', ')}`,
    );
  }
  return root;
}

/** `src/tests` — where a package's tests begin. */
export const TESTS_DIR = testsDir(TEST_INCLUDE);

/**
 * The vitest config a layer's project is declared in. One suite per side, named
 * by convention (docs/agents/testing.md) — the layer is the whole difference,
 * so the filename is built from it rather than listed.
 */
export function configOf(layer: TestLayer) {
  return `vitest.config.${layer}.ts`;
}
