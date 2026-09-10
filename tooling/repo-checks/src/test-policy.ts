/**
 * The per-package test policy (docs/TESTING.md).
 *
 * Every workspace package declares its test capability in package.json:
 *
 *   "acme": {
 *     "testClass": "backend-library",  // capability class (see TEST_CLASSES)
 *     "testStatus": "todo",            // optional; "todo" = tracked-but-allowed gap
 *     "reason": "why this gap/exemption exists"
 *   }
 *
 * Five things follow from that declaration, and each is a function below:
 *
 *   1. **The manifest.** A library-class package exposes the canonical test
 *      scripts for its class, or opts out with `testStatus: "todo"` and a
 *      reason. A missing `test` script meaning either "not needed" or "missing"
 *      is the ambiguity this removes.
 *   2. **The layout.** Every test sits under `src/tests/<layer>/`, and the
 *      layers a package carries follow its class. This lives here rather than
 *      in the vitest projects because `passWithNoTests` stays on — a misplaced
 *      file is collected by nothing and would otherwise fail nowhere at all.
 *   3. **The taxonomy.** A backend test files under `unit/` or
 *      `integration/{api,service}/`; a frontend one under `unit/` or
 *      `integration/{hooks,components}/`.
 *   4. **Unit purity.** A unit test that reaches for `vi.mock` / `vi.spyOn` /
 *      `vi.fn` needs collaborators, so it is an integration test.
 *   5. **The frontend seam-mock ban.** ESLint cannot carry this one: every
 *      `tests/` directory is globally ignored there, because tests read
 *      `process.env`.
 *
 * Each takes the values it reads and returns what is wrong. The rules used to
 * be one top-level `for` loop welded to three separate workspace walks, so
 * asserting a string comparison meant materialising a package tree on disk.
 */
import type { Violations } from '@acme/workspace-graph';
import { collectViolations } from '@acme/workspace-graph';

import type { PackageIo } from './io';
import { validateInfra, validateProvisioning } from './infra';
import { acmeBlock, scriptNames } from './manifest';

export const TEST_CLASSES: readonly string[] = [
  'full-stack',
  'backend-library',
  'frontend-library',
  'app',
  'none',
];

/** Library classes that owe canonical test scripts. */
export const LIBRARY_CLASSES: readonly string[] = [
  'full-stack',
  'backend-library',
  'frontend-library',
];

/** Canonical scripts a conforming package of each class must expose. */
export const REQUIRED_SCRIPTS: Readonly<Record<string, readonly string[]>> = {
  'full-stack': [
    'test',
    'test:backend',
    'test:backend:watch',
    'test:frontend',
    'test:frontend:watch',
    'test:watch',
  ],
  'backend-library': ['test', 'test:backend', 'test:backend:watch'],
  'frontend-library': ['test', 'test:frontend', 'test:frontend:watch'],
  app: [],
  none: [],
};

/**
 * The two test layers. `src/tests/<layer>/` is the only place a test may sit
 * (docs/TESTING.md): the layer segment is present even in a single-sided
 * package, so the vitest projects can own one glob each and the path prefix
 * stays a filter axis tooling can trust.
 */
export const TEST_LAYERS: readonly string[] = ['backend', 'frontend'];

/**
 * Which layers a package may carry, by capability class. Only the library
 * classes declare a side, so only they are constrained here; `app` / `none`
 * still owe the layer segment, they just aren't told which side to pick.
 */
const CLASS_LAYERS: Readonly<Record<string, readonly string[]>> = {
  'full-stack': ['backend', 'frontend'],
  'backend-library': ['backend'],
  'frontend-library': ['frontend'],
};

/** Anything a reader would call a test — see `isCollectible` for what runs. */
const TEST_FILE = /\.(test|spec)\.tsx?$/;

/**
 * The only folders a *backend* test (`*.test.ts`) may live in — the unit /
 * integration(api·service) taxonomy from docs/TESTING.md. Keeps the taxonomy
 * from silently regressing to the old flat `api/`/`service/`/`domain/` names.
 */
const BACKEND_SEGMENTS = [
  '/unit/',
  '/integration/api/',
  '/integration/service/',
];

/**
 * The only folders a *frontend* test (`*.test.tsx`, under `tests/frontend/`)
 * may live in — the unit / integration(hooks·components) taxonomy from
 * docs/TESTING.md. "integration" on the frontend means a React tree wired to a
 * real QueryClient with the network faked at the HTTP boundary (MSW); there is
 * no real-infra tier, so the term is weaker here than on the backend.
 */
const FRONTEND_SEGMENTS = [
  '/unit/',
  '/integration/hooks/',
  '/integration/components/',
];

/** A unit test needs no collaborators, so it reaches for none of these. */
const MOCK_CALLS = ['vi.mock(', 'vi.spyOn(', 'vi.fn('];

/**
 * Seams a frontend test must not mock: the tRPC client, the feature's own
 * hooks, react-toastify. Fake the network at the HTTP boundary (MSW) and assert
 * what renders. Framework externals (`next/navigation`, `@acme/auth`) stay
 * mockable and aren't matched.
 */
const FRONTEND_SEAM_MOCKS = [
  {
    re: /vi\.mock\(\s*['"][^'"]*trpc\/react['"]/,
    why: 'mocks the tRPC client you own — use trpcMsw + setupServer (MSW)',
  },
  {
    re: /vi\.mock\(\s*['"]\.\.?\/[^'"]*hooks[^'"]*['"]/,
    why: "mocks a feature's own hook — the hook is the contract; drive it through MSW",
  },
  {
    re: /vi\.mock\(\s*['"]react-toastify['"]/,
    why: 'mocks react-toastify — assert toasts via a real <ToastContainer /> in the DOM',
  },
];

/** Where to read the contract when a run fails. */
export const TEST_POLICY_HELP =
  'See docs/TESTING.md → "Package test policy" for the contract.';

/** A tracked, allowed gap — what `--todos` lists. */
export interface TestGap {
  readonly name: string;
  readonly testClass: string;
  readonly reason: string;
}

/** What a package declared, once the manifest rule accepts it. */
export interface DeclaredPolicy {
  readonly testClass: string;
  /** `testStatus: "todo"` — exempt from the layout rule, since nothing is filed yet. */
  readonly trackedGap: boolean;
}

export interface ManifestVerdict {
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
  /** Absent when the declaration is unusable — there is nothing further to check. */
  readonly policy?: DeclaredPolicy;
  readonly gap?: TestGap;
}

/**
 * Whether the vitest projects would actually collect `rel` (a package-relative
 * POSIX path). Mirrors the two globs in `@acme/test-utils/vitest`: backend is
 * `.test.ts` only, frontend takes `.test.ts` and `.test.tsx`, and neither
 * matches `*.spec.*`. A test file the globs miss is the silent failure this
 * whole rule exists to catch.
 */
export function isCollectible(rel: string): boolean {
  if (rel.startsWith('src/tests/backend/')) return rel.endsWith('.test.ts');
  if (rel.startsWith('src/tests/frontend/')) {
    return rel.endsWith('.test.ts') || rel.endsWith('.test.tsx');
  }
  return false;
}

/**
 * Whether the taxonomy and mock rules govern the package in `rel` — the runtime
 * layers only, as with the exports convention. Derived from the path rather
 * than listed, so it cannot drift from `pnpm-workspace.yaml`; it used to be
 * three verbatim copies of the same three-way `startsWith` inside one file.
 */
export const isRuntimeLayer = (rel: string) => rel.startsWith('packages/');

/** A manifest value as it should read in a message, whatever it turned out to be. */
const show = (value: unknown) =>
  typeof value === 'string' ? value : JSON.stringify(value);

/** Rule 1: the `acme` block and the scripts the declared class owes. */
export function validateTestManifest(
  name: string,
  acme: Readonly<Record<string, unknown>> | undefined,
  scripts: readonly string[],
): ManifestVerdict {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (acme === undefined || typeof acme.testClass !== 'string') {
    return {
      errors: [
        `${name}: missing "acme.testClass" in package.json (one of: ${TEST_CLASSES.join(', ')})`,
      ],
      warnings,
    };
  }

  const { testClass, testStatus, reason } = acme;

  if (!TEST_CLASSES.includes(testClass)) {
    return {
      errors: [
        `${name}: invalid "acme.testClass" \`${testClass}\` (one of: ${TEST_CLASSES.join(', ')})`,
      ],
      warnings,
    };
  }

  const isLibrary = LIBRARY_CLASSES.includes(testClass);

  if (testStatus !== undefined) {
    if (testStatus !== 'todo') {
      errors.push(
        `${name}: invalid "acme.testStatus" \`${show(testStatus)}\` (only "todo" is allowed)`,
      );
    } else if (!isLibrary) {
      errors.push(
        `${name}: "acme.testStatus: todo" is only valid on library classes, not \`${testClass}\``,
      );
    }
  }

  const trackedGap = testStatus === 'todo';
  const needsReason = trackedGap || testClass === 'app' || testClass === 'none';
  if (needsReason && typeof reason !== 'string') {
    errors.push(
      `${name}: "acme.reason" is required when testClass is app/none or testStatus is todo`,
    );
  }

  const missing = (REQUIRED_SCRIPTS[testClass] ?? []).filter(
    (script) => !scripts.includes(script),
  );

  let gap: TestGap | undefined;
  if (isLibrary) {
    if (trackedGap) {
      gap = {
        name,
        testClass,
        reason: typeof reason === 'string' ? reason : '',
      };
      // A tracked gap that already ships every script is a stale marker.
      if (missing.length === 0) {
        warnings.push(
          `${name}: marked "testStatus: todo" but already exposes all ${testClass} scripts — drop the todo`,
        );
      }
    } else if (missing.length > 0) {
      errors.push(
        `${name}: ${testClass} package is missing scripts: ${missing.join(', ')} (add them, or mark "acme.testStatus: todo" with a reason)`,
      );
    }
  }

  return { errors, warnings, policy: { testClass, trackedGap }, gap };
}

/**
 * Rule 2: one place a test can live, and the layers a class may carry.
 *
 * `files` is every package-relative POSIX path in the package, directories
 * included with a trailing `/` — the sidedness half reads the directory rather
 * than its contents, so an empty `frontend/` under a backend-library has to be
 * visible here.
 */
export function validateTestLayout(
  name: string,
  testClass: string,
  files: readonly string[],
): string[] {
  const errors: string[] = [];

  for (const rel of files.filter((file) => TEST_FILE.test(file))) {
    const layer = TEST_LAYERS.find((candidate) =>
      rel.startsWith(`src/tests/${candidate}/`),
    );
    if (!layer) {
      errors.push(
        `${name}: test outside the layout: ${rel} — every test lives under src/tests/backend/ or src/tests/frontend/, layer segment included`,
      );
    } else if (!isCollectible(rel)) {
      errors.push(
        `${name}: test the ${layer} project never collects: ${rel} — its glob is src/tests/${layer}/**/*.test.${layer === 'backend' ? 'ts' : '{ts,tsx}'}, so this file runs nowhere`,
      );
    }
  }

  // A frontend/ tree under a backend-library is either mis-filed tests or a
  // package that has quietly become full-stack — both need a decision.
  const classLayers = CLASS_LAYERS[testClass];
  for (const dir of layerDirs(files)) {
    if (!TEST_LAYERS.includes(dir)) {
      errors.push(
        `${name}: unknown test layer src/tests/${dir}/ — the layer segment is ${TEST_LAYERS.join(' or ')}`,
      );
    } else if (classLayers && !classLayers.includes(dir)) {
      errors.push(
        `${name}: ${testClass} package carries src/tests/${dir}/ — a ${testClass} has ${classLayers.map((layer) => `src/tests/${layer}/`).join(' + ')} only (move the tests, or change "acme.testClass")`,
      );
    }
  }

  return errors;
}

/** The directory names directly under `src/tests/`. */
function layerDirs(files: readonly string[]): string[] {
  const dirs = new Set<string>();
  for (const file of files) {
    const match = /^src\/tests\/([^/]+)\//.exec(file);
    if (match?.[1]) dirs.add(match[1]);
  }
  return [...dirs].sort();
}

/** Rule 3: a test files under the seam it exercises. */
export function validateTestTaxonomy(
  name: string,
  files: readonly string[],
): string[] {
  const errors: string[] = [];

  const backend = files.filter(
    (file) =>
      file.startsWith('src/tests/') &&
      file.endsWith('.test.ts') &&
      !file.includes('/frontend/'),
  );
  for (const rel of backend) {
    if (!BACKEND_SEGMENTS.some((segment) => rel.includes(segment))) {
      errors.push(
        `${name}: backend test outside the taxonomy: ${rel} — move under unit/, integration/api/, or integration/service/`,
      );
    }
  }

  const frontend = files.filter(
    (file) => file.startsWith('src/tests/') && file.endsWith('.test.tsx'),
  );
  for (const rel of frontend) {
    if (!FRONTEND_SEGMENTS.some((segment) => rel.includes(segment))) {
      errors.push(
        `${name}: frontend test outside the taxonomy: ${rel} — move under unit/, integration/hooks/, or integration/components/`,
      );
    }
  }

  return errors;
}

/** A file a content rule reads. */
export interface SourceFile {
  readonly rel: string;
  readonly text: string;
}

/** The paths rule 4 reads — solitary tests, wherever a package files them. */
export function unitTestPaths(files: readonly string[]): string[] {
  const dirs = [
    'src/tests/unit/',
    'src/tests/backend/unit/',
    'src/tests/frontend/unit/',
  ];
  return files.filter(
    (file) =>
      dirs.some((dir) => file.startsWith(dir)) &&
      (file.endsWith('.test.ts') || file.endsWith('.test.tsx')),
  );
}

/** The paths rule 5 reads — every frontend test *and* its setup files. */
export function frontendSourcePaths(files: readonly string[]): string[] {
  return files.filter(
    (file) =>
      file.startsWith('src/tests/frontend/') &&
      (file.endsWith('.ts') || file.endsWith('.tsx')),
  );
}

/** Rule 4: a unit test that needs a collaborator is an integration test. */
export function validateUnitPurity(
  name: string,
  files: readonly SourceFile[],
): string[] {
  const errors: string[] = [];
  for (const { rel, text } of files) {
    const found = MOCK_CALLS.find((pattern) => text.includes(pattern));
    if (found) {
      errors.push(
        `${name}: unit test uses mock/spy (${found}) — move to integration/: ${rel}`,
      );
    }
  }
  return errors;
}

/** Rule 5: a frontend test never mocks a seam the feature owns. */
export function validateFrontendSeamMocks(
  rel: string,
  files: readonly SourceFile[],
): string[] {
  const errors: string[] = [];
  for (const file of files) {
    for (const { re, why } of FRONTEND_SEAM_MOCKS) {
      if (re.test(file.text)) {
        errors.push(`${rel}: frontend test ${why}: ${file.rel}`);
      }
    }
  }
  return errors;
}

/**
 * The contradiction tripwire: a package asserted test-free that nonetheless
 * ships UI or an API router is mis-classified. A warning, not an error — it is
 * a judgement call about the class, not a broken rule.
 */
export function testClassContradictions(
  name: string,
  testClass: string,
  files: readonly string[],
): string[] {
  if (testClass !== 'none') return [];
  const warnings: string[] = [];
  if (files.some((file) => file.startsWith('src/') && file.endsWith('.tsx'))) {
    warnings.push(
      `${name}: testClass "none" but ships .tsx (UI) under src — reconsider as frontend-library/full-stack`,
    );
  }
  if (files.includes('src/api/')) {
    warnings.push(
      `${name}: testClass "none" but ships src/api (router) — reconsider as backend-library/full-stack`,
    );
  }
  return warnings;
}

export interface TestPolicyResult {
  readonly violations: Violations;
  readonly gaps: readonly TestGap[];
}

/**
 * Every rule above, over every workspace package — one walk of the workspace
 * and one walk per package, where this used to walk the workspace three times
 * and each package five.
 *
 * `profiles` are the compose profiles an `acme.infra` entry may name;
 * `undefined` when the repo ships no compose file, which is the one case there
 * is nothing to validate against.
 */
export function checkTestPolicy(
  io: PackageIo,
  profiles?: readonly string[],
): TestPolicyResult {
  const violations = collectViolations();
  const gaps: TestGap[] = [];

  for (const pkg of io.packages()) {
    const acme = acmeBlock(pkg.manifest);
    const verdict = validateTestManifest(
      pkg.name,
      acme,
      scriptNames(pkg.manifest),
    );

    for (const error of verdict.errors) violations.error(error);
    for (const warning of verdict.warnings) violations.warn(warning);
    if (verdict.gap) gaps.push(verdict.gap);

    if (profiles) {
      for (const error of validateInfra(pkg.name, acme, profiles)) {
        violations.error(error);
      }
      for (const error of validateProvisioning(
        pkg.name,
        acme,
        profiles,
        scriptNames(pkg.manifest),
        io.files(pkg),
      )) {
        violations.error(error);
      }
    }

    if (!verdict.policy) continue;
    const { testClass, trackedGap } = verdict.policy;
    const files = io.files(pkg);

    // A tracked gap has nothing filed yet, and the todo is the record of that.
    if (!trackedGap) {
      for (const error of validateTestLayout(pkg.name, testClass, files)) {
        violations.error(error);
      }
    }

    for (const warning of testClassContradictions(pkg.name, testClass, files)) {
      violations.warn(warning);
    }

    if (!isRuntimeLayer(pkg.rel)) continue;

    for (const error of validateTestTaxonomy(pkg.name, files)) {
      violations.error(error);
    }

    const read = (rel: string) => ({ rel, text: io.read(pkg, rel) });

    for (const error of validateUnitPurity(
      pkg.name,
      unitTestPaths(files).map(read),
    )) {
      violations.error(error);
    }

    for (const error of validateFrontendSeamMocks(
      pkg.rel,
      frontendSourcePaths(files).map(read),
    )) {
      violations.error(error);
    }
  }

  return { violations, gaps };
}
