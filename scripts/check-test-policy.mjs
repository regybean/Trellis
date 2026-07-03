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
 * Usage:
 *   node scripts/check-test-policy.mjs           # enforce policy (exit 1 on violation)
 *   node scripts/check-test-policy.mjs --todos   # list tracked test gaps, exit 0
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

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

/** Recursively test whether any file under `dir` matches `predicate`. */
function hasFile(dir, predicate) {
  if (!existsSync(dir)) return false;
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === ".turbo") {
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
    if (entry === "node_modules" || entry === "dist" || entry === ".turbo") {
      continue;
    }
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collectFiles(full, predicate, out);
    else if (predicate(full)) out.push(full);
  }
  return out;
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

  // Taxonomy filing: every backend test in a runtime layer must sit under
  // unit/ or integration/{api,service}/ (docs/TESTING.md). Catches a test left
  // in a stray old-name folder or loose under src/tests. Scoped to the runtime
  // layers; tooling/apps are out of scope (as with check-exports).
  const isRuntimeLayer =
    pkg.rel.startsWith("packages/platform/") ||
    pkg.rel.startsWith("packages/shared/") ||
    pkg.rel.startsWith("packages/features/");
  const testsDir = join(pkg.dir, "src", "tests");
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
