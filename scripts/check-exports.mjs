#!/usr/bin/env node
// @ts-check
/**
 * Package `exports` convention gate.
 *
 * Every workspace package that ships an `exports` map must follow the shared
 * convention (see docs/adr/0015-package-exports-convention.md):
 *
 *   1. Subpath keys are drawn from a bounded vocabulary — a fixed set of roles
 *      plus a handful of explicitly-registered one-off seams. No freeform
 *      subpaths: a new role is a deliberate edit here, not an ad-hoc addition.
 *
 *   2. Every entry uses the JIT source/compiled-types hybrid:
 *        "types"   -> ./dist/<name>.d.ts   (typecheck against prebuilt tsc output)
 *        "default" -> ./src/<name>.ts      (apps transpile raw TS)
 *      Nobody points `default` at `dist` (that would ship stale build output) or
 *      `types` at `src` (that would typecheck against untyped source).
 *
 * Usage:
 *   node scripts/check-exports.mjs   # enforce convention (exit 1 on violation)
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Runtime package layers this convention governs. Apps ship no `exports`;
 * `tooling/*` config packages deliberately use a different shape (freeform
 * config subpaths, consumed as config rather than JIT-transpiled runtime) and
 * are out of scope. See docs/adr/0015-package-exports-convention.md.
 */
const WORKSPACE_DIRS = [
  "packages/platform",
  "packages/shared",
  "packages/features",
  "packages/compositions",
];

/**
 * The bounded export vocabulary. Roles are the reusable concerns a package may
 * surface; seams are one-off entry points that earned a named home. Adding a key
 * here is the deliberate act of widening the vocabulary — that is the point.
 */
const ALLOWED_KEYS = new Set([
  // main entry
  ".",
  // roles
  "./server",
  "./schema",
  "./env",
  "./config", // config-as-code factory, sibling to ./env (ADR 0026)
  "./testing", // backend/test helpers shipped for consumers' suites
  // registered one-off seams
  "./handler", // @acme/trpc — framework-parametric fetch handler
  "./register", // @acme/telemetry — side-effecting preload entry
  "./server-next", // @acme/billing — Next-specific server adapter
  "./ownership-trpc", // @acme/rag — cross-feature ownership middleware
]);

const TYPES_RE = /^\.\/dist\/[\w./-]+\.d\.ts$/;
const DEFAULT_RE = /^\.\/src\/[\w./-]+\.ts$/;

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
        out.push({ manifest, rel: `${base}/${entry}` });
      }
    }
  }
  return out;
}

const errors = [];

for (const pkg of findPackages()) {
  /** @type {{ name?: string; exports?: Record<string, unknown> }} */
  const json = JSON.parse(readFileSync(pkg.manifest, "utf8"));
  const name = json.name ?? pkg.rel;
  const exportsMap = json.exports;

  // Apps and config-only packages ship no `exports` map — nothing to police.
  if (!exportsMap) continue;

  if (typeof exportsMap !== "object" || Array.isArray(exportsMap)) {
    errors.push(`${name}: "exports" must be an object map of subpath -> entry`);
    continue;
  }

  for (const [key, entry] of Object.entries(exportsMap)) {
    if (!ALLOWED_KEYS.has(key)) {
      errors.push(
        `${name}: export key \`${key}\` is not in the allowed vocabulary (${[...ALLOWED_KEYS].join(", ")}). Register it in scripts/check-exports.mjs if it is a deliberate new role/seam.`,
      );
      continue;
    }

    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      errors.push(
        `${name}: export \`${key}\` must be a { types, default } object`,
      );
      continue;
    }

    const record = /** @type {Record<string, unknown>} */ (entry);
    const extraKeys = Object.keys(record).filter(
      (k) => k !== "types" && k !== "default",
    );
    if (extraKeys.length > 0) {
      errors.push(
        `${name}: export \`${key}\` has unexpected keys: ${extraKeys.join(", ")} (only "types" and "default" are allowed)`,
      );
    }

    if (typeof record.types !== "string" || !TYPES_RE.test(record.types)) {
      errors.push(
        `${name}: export \`${key}\`.types must match ./dist/<name>.d.ts (got \`${String(record.types)}\`)`,
      );
    }
    if (
      typeof record.default !== "string" ||
      !DEFAULT_RE.test(record.default)
    ) {
      errors.push(
        `${name}: export \`${key}\`.default must match ./src/<name>.ts (got \`${String(record.default)}\`)`,
      );
    }
  }
}

if (errors.length > 0) {
  console.error(`\n✗ Export convention violations (${errors.length}):\n`);
  for (const e of errors) console.error(`  • ${e}`);
  console.error(
    `\nSee docs/adr/0015-package-exports-convention.md for the contract.\n`,
  );
  process.exit(1);
}

console.log("✓ Export convention satisfied.");
