#!/usr/bin/env node
// Sync .claudeignore -> .claude/settings.json permissions.deny.
// .claudeignore is the source of truth (gitignore-style patterns). This turns
// each pattern into native Claude Code `Read(...)` deny rules — the only
// enforcement CC applies (there is no built-in .claudeignore). Idempotent:
// regenerates the deny array wholesale and strips the legacy claude-ignore hook.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ignorePath = join(root, ".claudeignore");
const settingsPath = join(root, ".claude", "settings.json");

/** gitignore-style pattern -> one or more CC Read() deny globs. */
function toGlobs(raw) {
  const dirOnly = raw.endsWith("/");
  const anchored = raw.startsWith("/");
  let p = raw.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!p) return [];
  // Unanchored & path-less patterns match at any depth (gitignore semantics).
  const base = anchored || p.includes("/") ? p : `**/${p}`;
  return dirOnly ? [`${base}/**`] : [base, `${base}/**`];
}

const patterns = readFileSync(ignorePath, "utf8")
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("#"));

const deny = [
  ...new Set(patterns.flatMap(toGlobs).map((g) => `Read(${g})`)),
].sort();

const settings = existsSync(settingsPath)
  ? JSON.parse(readFileSync(settingsPath, "utf8"))
  : {};

// Drop the legacy broken claude-ignore PreToolUse hook if present.
if (settings.hooks?.PreToolUse) {
  settings.hooks.PreToolUse = settings.hooks.PreToolUse.filter(
    (e) => !e.hooks?.some((h) => h.command === "claude-ignore"),
  );
  if (settings.hooks.PreToolUse.length === 0) delete settings.hooks.PreToolUse;
  if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
}

settings.permissions = { ...settings.permissions, deny };

writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
console.log(
  `Synced ${deny.length} deny rules from .claudeignore -> ${settingsPath}`,
);
