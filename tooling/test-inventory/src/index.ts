/**
 * `@acme/test-inventory` — what the suite collects, as a document.
 *
 * The CLI is `./cli`; this is the parts it is made of. They are separated where
 * the seams are worth testing: what the layout implies (`./layout`), what there
 * is to collect (`./suites`), what `vitest list` said (`./collect`), what the
 * argv meant (`./flags`) and the markdown that comes out (`./render`). Only
 * `./collect` starts a process, so everything else is assertable as a function
 * over a value.
 *
 * Consumed from source (no build step): nothing builds `tooling/*` at install
 * time, so a compile step would leave this broken for the `pnpm lint` that runs
 * immediately after `pnpm install`.
 */
export type { TestLayer } from './layout';
export { configOf, TEST_LAYERS, TESTS_DIR, testsDir } from './layout';

export type { InventoryLayer, InventoryPackage, Suite } from './suites';
export {
  expandTargets,
  findPackages,
  findSuites,
  inventoryLayers,
} from './suites';

export { listSuite, mapLimit, vitestBin } from './collect';

export type { InventoryArgs, ParsedArgs } from './flags';
export { parseArguments, USAGE } from './flags';

export type {
  CollectedSuite,
  Filters,
  InventoryEntry,
  RenderOptions,
} from './render';
export { matches, render } from './render';
