#!/usr/bin/env node
// @ts-check
/**
 * Package test policy gate.
 *
 * Every workspace package declares its test capability via an `acme` block in
 * package.json:
 *
 *   "acme": {
 *     "testClass": "backend-library",  // capability class (see TEST_CLASSES)
 *     "testStatus": "todo",            // optional; "todo" = tracked-but-allowed gap
 *     "reason": "why this gap/exemption exists"
 *   }
 *
 * The checker asserts that each library-class package either exposes the
 * canonical test scripts for its class, or explicitly opts out with
 * `testStatus: "todo"` + a reason. This removes the ambiguity of a missing
 * `test` script meaning either "not needed" or "missing".
 *
 * It also asserts the **layout**: every test file sits under
 * `src/tests/<layer>/`, and the layers a package carries follow its class.
 * That rule lives here rather than in the vitest projects because
 * `passWithNoTests` stays on — a misplaced file is collected by nothing and
 * would otherwise fail nowhere at all.
 *
 * Usage:
 *   node scripts/check-test-policy.mjs           # enforce policy (exit 1 on violation)
 *   node scripts/check-test-policy.mjs --todos   # list tracked test gaps, exit 0
 *   node scripts/check-test-policy.mjs <root>    # check that workspace root instead
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** First non-flag argument wins, so `--todos` can be passed with or without it. */
const rootArg = process.argv.slice(2).find((a) => !a.startsWith("--"));
const ROOT = rootArg
  ? resolve(rootArg)
  : join(dirname(fileURLToPath(import.meta.url)), "..");

/** Workspace globs, mirrored from pnpm-workspace.yaml (each is `<dir>/*`). */
const WORKSPACE_DIRS = [
  "apps",
  "packages/platform",
  "packages/shared",
  "packages/features",
  "packages/compositions",
  "tooling",
];

const TEST_CLASSES = new Set([
  "full-stack",
  "backend-library",
  "frontend-library",
  "app",
  "none",
]);

/** Library classes that owe canonical test scripts. */
const LIBRARY_CLASSES = new Set([
  "full-stack",
  "backend-library",
  "frontend-library",
]);

/** Canonical scripts a conforming package of each class must expose. */
const REQUIRED_SCRIPTS = {
  "full-stack": [
    "test",
    "test:backend",
    "test:backend:watch",
    "test:frontend",
    "test:frontend:watch",
    "test:watch",
  ],
  "backend-library": ["test", "test:backend", "test:backend:watch"],
  "frontend-library": ["test", "test:frontend", "test:frontend:watch"],
  app: [],
  none: [],
};

/** Discover every workspace package directory holding a package.json. */
function findPackages() {
  const out = [];
  for (const base of WORKSPACE_DIRS) {
    const baseDir = join(ROOT, base);
    if (!existsSync(baseDir)) continue;
    for (const entry of readdirSync(baseDir)) {
      const dir = join(baseDir, entry);
      const manifest = join(dir, "package.json");
      if (statSync(dir).isDirectory() && existsSync(manifest)) {
        out.push({ dir, manifest, rel: `${base}/${entry}` });
      }
    }
  }
  return out;
}

/** Build output and caches — never source, so never a misplaced test. */
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  ".turbo",
  ".cache",
  ".next",
  "coverage",
]);

/** Recursively test whether any file under `dir` matches `predicate`. */
function hasFile(dir, predicate) {
  if (!existsSync(dir)) return false;
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) {
      continue;
    }
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (hasFile(full, predicate)) return true;
    } else if (predicate(full)) {
      return true;
    }
  }
  return false;
}

/** Recursively collect every file under `dir` matching `predicate`. */
function collectFiles(dir, predicate, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) {
      continue;
    }
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collectFiles(full, predicate, out);
    else if (predicate(full)) out.push(full);
  }
  return out;
}

/**
 * The two test layers. `src/tests/<layer>/` is the only place a test may sit
 * (docs/TESTING.md): the layer segment is present even in a single-sided
 * package, so the vitest projects can own one glob each and the path prefix
 * stays a filter axis tooling can trust.
 */
const TEST_LAYERS = ["backend", "frontend"];

/**
 * Which layers a package may carry, by capability class. Only the library
 * classes declare a side, so only they are constrained here; `app` / `none`
 * still owe the layer segment, they just aren't told which side to pick.
 */
const CLASS_LAYERS = {
  "full-stack": ["backend", "frontend"],
  "backend-library": ["backend"],
  "frontend-library": ["frontend"],
};

/** Anything a reader would call a test — see `isCollectible` for what runs. */
const TEST_FILE = /\.(test|spec)\.tsx?$/;

/**
 * Whether the vitest projects would actually collect `rel` (a package-relative
 * POSIX path). Mirrors the two globs in `@acme/test-utils/vitest`: backend is
 * `.test.ts` only, frontend takes `.test.ts` and `.test.tsx`, and neither
 * matches `*.spec.*`. A test file the globs miss is the silent failure this
 * whole rule exists to catch.
 */
function isCollectible(rel) {
  if (rel.startsWith("src/tests/backend/")) return rel.endsWith(".test.ts");
  if (rel.startsWith("src/tests/frontend/"))
    return rel.endsWith(".test.ts") || rel.endsWith(".test.tsx");
  return false;
}

/**
 * The only folders a *backend* test (`*.test.ts`) may live in — the unit /
 * integration(api·service) taxonomy from docs/TESTING.md. Keeps the taxonomy
 * from silently regressing to the old flat `api/`/`service/`/`domain/` names.
 */
const ALLOWED_TEST_SEGMENTS = [
  "/unit/",
  "/integration/api/",
  "/integration/service/",
];

/**
 * The only folders a *frontend* test (`*.test.tsx`, under `tests/frontend/`) may
 * live in — the unit / integration(hooks·components) taxonomy from
 * docs/TESTING.md + ADR 0018. "integration" on the frontend means a React tree
 * wired to a real QueryClient with the network faked at the HTTP boundary (MSW);
 * there is no real-infra tier, so the term is weaker here than on the backend.
 */
const ALLOWED_FRONTEND_SEGMENTS = [
  "/unit/",
  "/integration/hooks/",
  "/integration/components/",
];

const errors = [];
const warnings = [];
const todos = [];

for (const pkg of findPackages()) {
  /** @type {{ name?: string; scripts?: Record<string, string>; acme?: { testClass?: string; testStatus?: string; reason?: string } }} */
  const json = JSON.parse(readFileSync(pkg.manifest, "utf8"));
  const name = json.name ?? pkg.rel;
  const acme = json.acme;
  const scripts = json.scripts ?? {};

  if (!acme || typeof acme.testClass !== "string") {
    errors.push(
      `${name}: missing "acme.testClass" in package.json (one of: ${[...TEST_CLASSES].join(", ")})`,
    );
    continue;
  }

  const { testClass, testStatus, reason } = acme;

  if (!TEST_CLASSES.has(testClass)) {
    errors.push(
      `${name}: invalid "acme.testClass" \`${testClass}\` (one of: ${[...TEST_CLASSES].join(", ")})`,
    );
    continue;
  }

  if (testStatus !== undefined) {
    if (testStatus !== "todo") {
      errors.push(
        `${name}: invalid "acme.testStatus" \`${testStatus}\` (only "todo" is allowed)`,
      );
    } else if (!LIBRARY_CLASSES.has(testClass)) {
      errors.push(
        `${name}: "acme.testStatus: todo" is only valid on library classes, not \`${testClass}\``,
      );
    }
  }

  const needsReason =
    testStatus === "todo" || testClass === "app" || testClass === "none";
  if (needsReason && !reason) {
    errors.push(
      `${name}: "acme.reason" is required when testClass is app/none or testStatus is todo`,
    );
  }

  const required = REQUIRED_SCRIPTS[testClass] ?? [];
  const missing = required.filter((s) => !scripts[s]);

  if (LIBRARY_CLASSES.has(testClass)) {
    if (testStatus === "todo") {
      todos.push({ name, testClass, reason: reason ?? "" });
      // A tracked gap that already ships every script is a stale marker.
      if (missing.length === 0) {
        warnings.push(
          `${name}: marked "testStatus: todo" but already exposes all ${testClass} scripts — drop the todo`,
        );
      }
    } else if (missing.length > 0) {
      errors.push(
        `${name}: ${testClass} package is missing scripts: ${missing.join(", ")} (add them, or mark "acme.testStatus: todo" with a reason)`,
      );
    }
  }

  const testsDir = join(pkg.dir, "src", "tests");

  // Layout: one place a test can live — `src/tests/<layer>/`. Every package,
  // every class; a tracked gap (`testStatus: todo`) is exempt, since it has
  // nothing filed yet and the todo is the record of that. The check is on the
  // *path*, because the vitest projects can't make this failure: their globs
  // simply don't match a misplaced file, and `passWithNoTests` (which stays on
  // — a package that legitimately collects nothing must still pass) turns that
  // into silence.
  if (testStatus !== "todo") {
    for (const file of collectFiles(pkg.dir, (f) => TEST_FILE.test(f))) {
      const rel = file.slice(pkg.dir.length + 1).replaceAll(sep, "/");
      const layer = TEST_LAYERS.find((l) => rel.startsWith(`src/tests/${l}/`));
      if (!layer) {
        errors.push(
          `${name}: test outside the layout: ${rel} — every test lives under src/tests/backend/ or src/tests/frontend/, layer segment included`,
        );
      } else if (!isCollectible(rel)) {
        errors.push(
          `${name}: test the ${layer} project never collects: ${rel} — its glob is src/tests/${layer}/**/*.test.${layer === "backend" ? "ts" : "{ts,tsx}"}, so this file runs nowhere`,
        );
      }
    }

    // Sidedness: the layer directories a package carries follow its class. A
    // frontend/ tree under a backend-library is either mis-filed tests or a
    // package that has quietly become full-stack — both need a decision.
    const classLayers = CLASS_LAYERS[testClass];
    const layerDirs = existsSync(testsDir)
      ? readdirSync(testsDir).filter((e) =>
          statSync(join(testsDir, e)).isDirectory(),
        )
      : [];
    for (const dir of layerDirs) {
      if (!TEST_LAYERS.includes(dir)) {
        errors.push(
          `${name}: unknown test layer src/tests/${dir}/ — the layer segment is ${TEST_LAYERS.join(" or ")}`,
        );
      } else if (classLayers && !classLayers.includes(dir)) {
        errors.push(
          `${name}: ${testClass} package carries src/tests/${dir}/ — a ${testClass} has ${classLayers.map((l) => `src/tests/${l}/`).join(" + ")} only (move the tests, or change "acme.testClass")`,
        );
      }
    }
  }

  // Taxonomy filing: every backend test in a runtime layer must sit under
  // unit/ or integration/{api,service}/ (docs/TESTING.md). Catches a test left
  // in a stray old-name folder or loose under src/tests. Scoped to the runtime
  // layers; tooling/apps are out of scope (as with check-exports).
  const isRuntimeLayer =
    pkg.rel.startsWith("packages/platform/") ||
    pkg.rel.startsWith("packages/shared/") ||
    pkg.rel.startsWith("packages/features/");
  const backendTests = isRuntimeLayer
    ? collectFiles(
        testsDir,
        (f) => f.endsWith(".test.ts") && !f.includes(`${sep}frontend${sep}`),
      )
    : [];
  for (const file of backendTests) {
    const posix = file.replaceAll(sep, "/");
    if (!ALLOWED_TEST_SEGMENTS.some((seg) => posix.includes(seg))) {
      const rel = posix.slice(posix.indexOf("/src/tests/"));
      errors.push(
        `${name}: backend test outside the taxonomy: ${rel} — move under unit/, integration/api/, or integration/service/`,
      );
    }
  }

  // Same taxonomy filing for frontend tests (`*.test.tsx`): unit/ or
  // integration/{hooks,components}/ (docs/TESTING.md + ADR 0018).
  const frontendTests = isRuntimeLayer
    ? collectFiles(testsDir, (f) => f.endsWith(".test.tsx"))
    : [];
  for (const file of frontendTests) {
    const posix = file.replaceAll(sep, "/");
    if (!ALLOWED_FRONTEND_SEGMENTS.some((seg) => posix.includes(seg))) {
      const rel = posix.slice(posix.indexOf("/src/tests/"));
      errors.push(
        `${name}: frontend test outside the taxonomy: ${rel} — move under unit/, integration/hooks/, or integration/components/`,
      );
    }
  }

  // Contradiction tripwire: a package asserted test-free that nonetheless
  // ships UI or an API router is mis-classified.
  if (testClass === "none") {
    const src = join(pkg.dir, "src");
    if (hasFile(src, (f) => f.endsWith(".tsx"))) {
      warnings.push(
        `${name}: testClass "none" but ships .tsx (UI) under src — reconsider as frontend-library/full-stack`,
      );
    }
    if (existsSync(join(src, "api"))) {
      warnings.push(
        `${name}: testClass "none" but ships src/api (router) — reconsider as backend-library/full-stack`,
      );
    }
  }
}

// Unit purity check: a unit test that imports or uses vi.mock / vi.spyOn /
// vi.fn is mis-filed — it needs collaborators and belongs in integration/.
const MOCK_CALL_PATTERNS = ["vi.mock(", "vi.spyOn(", "vi.fn("];
for (const pkg of findPackages()) {
  const isRuntimeLayer =
    pkg.rel.startsWith("packages/platform/") ||
    pkg.rel.startsWith("packages/shared/") ||
    pkg.rel.startsWith("packages/features/");
  if (!isRuntimeLayer) continue;

  // Platform packages: src/tests/unit/   Feature packages: src/tests/backend/unit/
  // Frontend pure logic: src/tests/frontend/unit/ (also solitary — no mocks).
  const unitDirs = [
    join(pkg.dir, "src", "tests", "unit"),
    join(pkg.dir, "src", "tests", "backend", "unit"),
    join(pkg.dir, "src", "tests", "frontend", "unit"),
  ];

  for (const unitDir of unitDirs) {
    const unitTests = collectFiles(
      unitDir,
      (f) => f.endsWith(".test.ts") || f.endsWith(".test.tsx"),
    );
    for (const file of unitTests) {
      const content = readFileSync(file, "utf8");
      for (const pattern of MOCK_CALL_PATTERNS) {
        if (content.includes(pattern)) {
          const rel = file.slice(file.indexOf("/src/tests/"));
          errors.push(
            `${pkg.name}: unit test uses mock/spy (${pattern}) — move to integration/: ${rel}`,
          );
          break;
        }
      }
    }
  }
}

// Frontend seam-mock ban (ADR 0018): a frontend test/setup must not `vi.mock`
// a seam the feature owns — the tRPC client, its own hooks, or react-toastify.
// Fake the network at the HTTP boundary (MSW) and assert what renders. ESLint
// can't carry this rule because `**/tests/**` is globally ignored (tests read
// process.env), so it lives here beside the unit-purity scan. Framework
// externals (`next/navigation`, `@acme/auth`) stay mockable and aren't matched.
const FRONTEND_SEAM_MOCKS = [
  {
    re: /vi\.mock\(\s*['"][^'"]*trpc\/react['"]/,
    why: "mocks the tRPC client you own — use trpcMsw + setupServer (MSW)",
  },
  {
    re: /vi\.mock\(\s*['"]\.\.?\/[^'"]*hooks[^'"]*['"]/,
    why: "mocks a feature's own hook — the hook is the contract; drive it through MSW",
  },
  {
    re: /vi\.mock\(\s*['"]react-toastify['"]/,
    why: "mocks react-toastify — assert toasts via a real <ToastContainer /> in the DOM",
  },
];
for (const pkg of findPackages()) {
  const isRuntimeLayer =
    pkg.rel.startsWith("packages/platform/") ||
    pkg.rel.startsWith("packages/shared/") ||
    pkg.rel.startsWith("packages/features/");
  if (!isRuntimeLayer) continue;

  const frontendDir = join(pkg.dir, "src", "tests", "frontend");
  const frontendFiles = collectFiles(
    frontendDir,
    (f) => f.endsWith(".ts") || f.endsWith(".tsx"),
  );
  for (const file of frontendFiles) {
    const content = readFileSync(file, "utf8");
    for (const { re, why } of FRONTEND_SEAM_MOCKS) {
      if (re.test(content)) {
        const rel = file.slice(file.indexOf("/src/tests/"));
        errors.push(`${pkg.rel}: frontend test ${why} (ADR 0018): ${rel}`);
      }
    }
  }
}

if (process.argv.includes("--todos")) {
  if (todos.length === 0) {
    console.log("No tracked test gaps — every library package is conforming.");
  } else {
    console.log(`Tracked test gaps (${todos.length}):\n`);
    for (const t of todos.sort((a, b) => a.name.localeCompare(b.name))) {
      console.log(`  • ${t.name} [${t.testClass}] — ${t.reason}`);
    }
  }
  process.exit(0);
}

for (const w of warnings) console.warn(`⚠️  ${w}`);

if (errors.length > 0) {
  console.error(`\n✗ Test policy violations (${errors.length}):\n`);
  for (const e of errors) console.error(`  • ${e}`);
  console.error(
    `\nSee docs/TESTING.md → "Package test policy" for the contract.\n`,
  );
  process.exit(1);
}

console.log(
  `✓ Test policy satisfied (${todos.length} tracked gap${todos.length === 1 ? "" : "s"}; run \`pnpm test:policy --todos\` to list).`,
);
