#!/usr/bin/env bash
set -euo pipefail

# Register vendored skills so Claude Code can discover them.
#
# Source of truth: .agents/skills/<name>/  (committed to git)
# Registration:    .claude/skills/<name>   (gitignored; symlink into .agents)
#
# .claude is gitignored, so the symlinks don't survive a clone. This script
# recreates them idempotently from whatever is in .agents/skills. Run after
# clone / pnpm install, or any time skills are added or removed.

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
src="$repo_root/.agents/skills"
dst="$repo_root/.claude/skills"

if [ ! -d "$src" ]; then
  echo "register-skills: no $src — nothing to register" >&2
  exit 0
fi

mkdir -p "$dst"

# Prune stale links pointing at skills that no longer exist in .agents.
for link in "$dst"/*; do
  [ -L "$link" ] || continue
  [ -e "$link" ] || { echo "prune  $(basename "$link") (dangling)"; rm -f "$link"; }
done

linked=0
for skill_dir in "$src"/*/; do
  [ -f "$skill_dir/SKILL.md" ] || continue
  name="$(basename "$skill_dir")"
  link="$dst/$name"
  # Replace anything that isn't already the correct symlink.
  if [ -L "$link" ] && [ "$(readlink "$link")" = "../../.agents/skills/$name" ]; then
    continue
  fi
  rm -rf "$link"
  ln -s "../../.agents/skills/$name" "$link"
  echo "link   $name"
  linked=$((linked + 1))
done

echo "register-skills: $linked change(s); $(find "$dst" -maxdepth 1 -type l | wc -l | tr -d ' ') skill(s) registered"
