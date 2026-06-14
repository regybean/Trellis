#!/usr/bin/env sh
set -eu

# Render a Turborepo task graph as a Mermaid file under docs/.
# Open it with a Mermaid Preview VSCode extension (pan/zoom).
#
# No args -> the package dependency graph (the synthetic `topo` task).
# Pass task name(s) to graph those instead; filename derives from them.
#   scripts/graph.sh                -> docs/task-graph-topo.mermaid
#   scripts/graph.sh lint typecheck -> docs/task-graph-lint-typecheck.mermaid
#
# Tooling (tooling/*) and platform (packages/platform/*) packages are depended
# on by everything and dominate the graph, so they are stripped by default.
# Set GRAPH_FULL=1 to keep them.

if [ "$#" -eq 0 ]; then
  set -- topo
fi

slug=$(printf '%s' "$*" | tr ' :' '--')
out="docs/task-graph-${slug}.mermaid"

turbo run "$@" --graph="$out"

body=$(cat "$out")

if [ -z "${GRAPH_FULL:-}" ]; then
  # Names of every package under tooling/ and packages/platform/, derived at
  # runtime — both are foundational layers depended on by everything.
  strip=$(node -e 'const fs=require("fs");for(const base of ["tooling","packages/platform"]){let ds;try{ds=fs.readdirSync(base)}catch{continue}for(const d of ds){try{process.stdout.write(require(process.cwd()+"/"+base+"/"+d+"/package.json").name+"\n")}catch{}}}')
  if [ -n "$strip" ]; then
    # grep -F treats each newline-separated name as a fixed pattern; drop any
    # mermaid edge line referencing a tooling/platform package on either side.
    body=$(printf '%s\n' "$body" | grep -vF "$strip")
  fi
fi

# Prepend a Mermaid config header: the ELK layout engine lays the graph out in
# clean layers instead of dagre's crossing spaghetti. Override with GRAPH_LAYOUT.
{
  printf -- '---\nconfig:\n  layout: %s\n---\n' "${GRAPH_LAYOUT:-elk}"
  printf '%s\n' "$body"
} > "$out"

printf 'Wrote %s\n' "$out"
