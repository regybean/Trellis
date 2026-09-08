#!/usr/bin/env bash
set -euo pipefail

# Prettier the staged files, minus symlinks.
#
# Passing a symlink to Prettier explicitly is a hard error ("Explicitly
# specified pattern ... is a symbolic link", exit 2) rather than a skip, and the
# repo tracks symlinks that match the format glob — CLAUDE.md and
# .github/copilot-instructions.md both point at AGENTS.md. Formatting the link
# would be meaningless anyway: the body lives at the target, which is staged and
# formatted on its own.

args=()
for f in "$@"; do
  [ -L "$f" ] && continue
  args+=("$f")
done

# Nothing left once links are dropped — Prettier with no file args would treat
# it as a usage error.
[ ${#args[@]} -gt 0 ] || exit 0

exec pnpm exec prettier --write --ignore-unknown "${args[@]}"
