/**
 * `@acme/repo-checks` — the gates `pnpm lint` runs over the repo itself.
 *
 * The checkers living here are the package `exports` convention, the
 * per-package test policy, ADR hygiene, portability and the undeclared-import
 * gate. Most used to be a top-level `for` loop in `scripts/`, so their
 * decisions could not be reached without running the program, and the
 * filesystem walk was welded to the rule.
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
export type { AdrCitation, AdrDirectory, AdrResult, RuleResult } from './adrs';
export {
  ADRS_HELP,
  CONTEXT_MAP,
  adrCitations,
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
  DEPENDENCY_FIELDS,
  IMPORTS_HELP,
  SUPPRESSION_KEY,
  checkImports,
  declaredPackages,
  importedPackages,
  isSource,
  specifierPackage,
  suppressions,
} from './imports';

export {
  COMPOSE_FILE,
  composeProfiles,
  composeProfilesAt,
  validateInfra,
  validateProvisioning,
} from './infra';

export { acmeBlock, scriptNames } from './manifest';

export type { PortableResult } from './portable';
export {
  NOT_DISTRIBUTED,
  PORTABLE_HELP,
  ROOT_ADR_DIR,
  checkPortable,
  owningPackage,
  validateAdrNumbers,
  validateAdrScope,
  validateIssueRefs,
  validateRootAdrApps,
} from './portable';

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
