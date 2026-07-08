#!/usr/bin/env node
// Symlink the primary checkout's .env files into a linked git worktree.
//
// A worktree branches `fresh` and .env is gitignored, so it never comes along —
// but `next build` (and running the app) needs real runtime env: env.ts is
// skipped at build time, yet route modules still construct clients eagerly
// (e.g. `new PgVector({ host: DB_HOST })` in @acme/rag), which throws on an
// empty host. Rather than lazy-init every such client, the worktree inherits
// the primary checkout's env by symlink. See docs/adr/0019.
//
// Symlink (not copy) so edits to the primary .env are picked up and no stale
// secrets are duplicated on disk. Idempotent, and a no-op anywhere that isn't a
// linked worktree — including the primary checkout and real CI (which has no
// linked worktree), so it never clobbers a real .env. Runs in the postinstall
// chain; any failure is swallowed so it can never break `pnpm install`.

import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  readdirSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { dirname, join } from "node:path";

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();

function linkWorktreeEnv() {
  const gitDir = git("rev-parse", "--path-format=absolute", "--git-dir");
  const commonDir = git(
    "rev-parse",
    "--path-format=absolute",
    "--git-common-dir",
  );

  // Equal dirs => primary checkout (or a plain clone). Only linked worktrees,
  // whose per-worktree git-dir lives under <primary>/.git/worktrees/<name>, differ.
  if (gitDir === commonDir) return;

  const primaryRoot = dirname(commonDir); // <primary>/.git -> <primary>
  const worktreeRoot = git("rev-parse", "--show-toplevel");

  // Candidate env files, relative to a checkout root: root + each app.
  const relPaths = [".env"];
  const appsDir = join(primaryRoot, "apps");
  if (existsSync(appsDir)) {
    for (const app of readdirSync(appsDir))
      relPaths.push(join("apps", app, ".env"));
  }

  let linked = 0;
  for (const rel of relPaths) {
    const src = join(primaryRoot, rel);
    if (!existsSync(src)) continue;

    const dest = join(worktreeRoot, rel);
    // Leave a real file the user placed here; only (re)link our own symlink.
    if (existsSync(dest)) {
      if (!lstatSync(dest).isSymbolicLink()) continue;
      unlinkSync(dest);
    }
    symlinkSync(src, dest);
    linked += 1;
  }

  if (linked > 0) {
    console.log(
      `Linked ${linked} .env file(s) from ${primaryRoot} into worktree`,
    );
  }
}

try {
  linkWorktreeEnv();
} catch (error) {
  console.warn(`link-worktree-env: skipped (${error.message})`);
}
