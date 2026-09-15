#!/usr/bin/env node
// Symlink the primary checkout's .env files, and its turbo link config, into a
// linked git worktree.
//
// A worktree branches `fresh` and .env is gitignored, so it never comes along —
// but `next build` (and running the app) needs real runtime env: env.ts is
// skipped at build time, yet route modules still construct clients eagerly
// (e.g. `new PgVector({ host: DB_HOST })` in @acme/rag), which throws on an
// empty host. Rather than lazy-init every such client, the worktree inherits
// the primary checkout's env by symlink.
//
// `.turbo/config.json` comes along for the same reason. It holds the `teamId`
// `turbo link` wrote, and it is gitignored, so a fresh worktree has no link —
// turbo then reports "Remote caching disabled" and rebuilds from scratch what
// the primary checkout already uploaded. The auth token needs no linking: it
// lives in the user-global turbo config, which every worktree already sees.
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
  mkdirSync,
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

  // Candidate env files, relative to a checkout root: deploy (infra secrets) +
  // each app. The root application .env was deprecated — each app owns its env
  // entirely now.
  const relPaths = ["deploy/.env"];
  const appsDir = join(primaryRoot, "apps");
  if (existsSync(appsDir)) {
    for (const app of readdirSync(appsDir))
      relPaths.push(join("apps", app, ".env"));
  }
  // Not an env file, but inherited on the same terms — see the header.
  relPaths.push(join(".turbo", "config.json"));

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
    // `.turbo/` is gitignored, so unlike the env paths its parent may not exist
    // in a fresh worktree yet.
    mkdirSync(dirname(dest), { recursive: true });
    symlinkSync(src, dest);
    linked += 1;
  }

  if (linked > 0) {
    console.log(`Linked ${linked} file(s) from ${primaryRoot} into worktree`);
  }
}

try {
  linkWorktreeEnv();
} catch (error) {
  console.warn(`link-worktree-env: skipped (${error.message})`);
}
