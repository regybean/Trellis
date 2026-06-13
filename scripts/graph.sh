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
# Tooling packages (tooling/*) are depended on by everything and dominate the
# graph, so they are stripped by default. Set GRAPH_FULL=1 to keep them.

if [ "$#" -eq 0 ]; then
  set -- topo
fi

slug=$(printf '%s' "$*" | tr ' :' '--')
out="docs/task-graph-${slug}.mermaid"

turbo run "$@" --graph="$out"

if [ -z "${GRAPH_FULL:-}" ]; then
  # Names of every package under tooling/, derived at runtime.
  tooling=$(node -e 'const fs=require("fs");for(const d of fs.readdirSync("tooling")){try{process.stdout.write(require(process.cwd()+"/tooling/"+d+"/package.json").name+"\n")}catch{}}')
  if [ -n "$tooling" ]; then
    # grep -F treats each newline-separated name as a fixed pattern; drop any
    # mermaid edge line referencing a tooling package on either side.
    kept=$(grep -vF "$tooling" "$out")
    printf '%s\n' "$kept" > "$out"
  fi
fi

printf 'Wrote %s\n' "$out"
