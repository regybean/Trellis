/**
 * `@acme/repo-checks` — the gates `pnpm lint` runs over the repo itself.
 *
 * Three checkers live here: the package `exports` convention (ADR 0015), the
 * per-package test policy (ADR 0007) and ADR hygiene. Each used to be a
 * top-level `for` loop in `scripts/`, so its decisions could not be reached
 * without running the program, and the filesystem walk was welded to the rule.
 *
 * Here each rule is a function over its input and the filesystem work happens
 * at the edge, behind `PackageIo` / `RepoIo`. That is what lets a rule be
 * asserted against a value, and it is what removed the temp-directory package
 * trees these tests used to build to check a string comparison.
 *
 * Consumed from source (no build step): nothing builds `tooling/*` at install
 * time, so a compile step would leave this broken for the `pnpm lint` that runs
 * immediately after `pnpm install`.
 */
export type { AdrDirectory, AdrResult, RuleResult } from './adrs';
export {
  ADRS_HELP,
  CONTEXT_MAP,
  adrDirectories,
  carriesCitations,
  checkAdrs,
  statusValue,
  validateCitations,
  validateMapRows,
  validateNumbering,
  validateStatus,
} from './adrs';

export type { PackageIo, RepoIo } from './io';
export { packageIo, repoIo } from './io';

export {
  ALLOWED_KEYS,
  EXPORTS_HELP,
  checkExports,
  isGoverned,
  validateExports,
} from './exports';

export {
  COMPOSE_FILE,
  composeProfiles,
  composeProfilesAt,
  validateInfra,
} from './infra';

export { acmeBlock, scriptNames } from './manifest';

export type {
  DeclaredPolicy,
  ManifestVerdict,
  SourceFile,
  TestGap,
  TestPolicyResult,
} from './test-policy';
export {
  LIBRARY_CLASSES,
  REQUIRED_SCRIPTS,
  TEST_CLASSES,
  TEST_LAYERS,
  TEST_POLICY_HELP,
  checkTestPolicy,
  frontendSourcePaths,
  isCollectible,
  isRuntimeLayer,
  testClassContradictions,
  unitTestPaths,
  validateFrontendSeamMocks,
  validateTestLayout,
  validateTestManifest,
  validateTestTaxonomy,
  validateUnitPurity,
} from './test-policy';
