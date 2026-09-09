#!/usr/bin/env bash
set -euo pipefail

# Point every per-harness agent brief at the one canonical file.
#
# Source of truth: AGENTS.md            (regular file, committed)
# Harness entries: CLAUDE.md            (tracked symlink -> AGENTS.md)
#                  .github/copilot-instructions.md (tracked symlink -> ../AGENTS.md)
#
# The symlinks are tracked, so they survive a clone; this script recreates them
# idempotently in case one gets clobbered by an editor or an agent writing a
# regular file over the link. Runs on `postinstall`, same as register-skills.sh.
# Divergence is the failure mode it exists to prevent: three real files drift,
# and only one of them gets updated.

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

canonical="AGENTS.md"

# A missing brief is absence, not breakage. AGENTS.md rides the `agents` bundle
# and this script rides `root`, so a consumer that took the bank without the
# agent config has nothing to point the harness entries at — and this runs inside
# a `set -euo pipefail` postinstall chain, where a refusal fails their first
# `pnpm install` outright. Exit 0 and say why, the same guard as
# sync-claudeignore.mjs for the same reason. Running the script directly still
# reports the skip.
#
# A brief that is *present but wrong* is breakage, and still refuses: a symlink
# has no body to link onto, and anything that is neither is not a brief.
if [ -L "$canonical" ]; then
  echo "link-agent-docs: $canonical is itself a symlink — refusing to relink" >&2
  exit 1
elif [ ! -e "$canonical" ]; then
  echo "link-agent-docs: no $canonical — nothing to link"
  exit 0
elif [ ! -f "$canonical" ]; then
  echo "link-agent-docs: $canonical is not a regular file — refusing to relink" >&2
  exit 1
fi

# link <path> <target-relative-to-that-path's-dir>
link() {
  local path="$1" target="$2"
  if [ -L "$path" ] && [ "$(readlink "$path")" = "$target" ]; then
    return 0
  fi
  # Anything that isn't already the correct link gets replaced. Content is not
  # merged — AGENTS.md is the only file whose body is authored.
  if [ -f "$path" ] && [ ! -L "$path" ] && ! diff -q "$path" "$canonical" >/dev/null 2>&1; then
    echo "link-agent-docs: $path is a regular file that differs from $canonical" >&2
    echo "                 fold any wanted changes into $canonical, then rerun" >&2
    return 1
  fi
  mkdir -p "$(dirname "$path")"
  rm -f "$path"
  ln -s "$target" "$path"
  echo "link   $path -> $target"
  linked=$((linked + 1))
}

linked=0
link "CLAUDE.md" "$canonical"
link ".github/copilot-instructions.md" "../$canonical"

echo "link-agent-docs: $linked change(s); briefs point at $canonical"
