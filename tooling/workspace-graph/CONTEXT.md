# Workspace Graph (`@acme/workspace-graph`)

The one reader of this repo's own workspace. It answers which directories hold
packages, what each package declares, which package a command-line token names,
what a package's closure contains and what that closure needs running — plus the
CLI convention every repo checker follows when it reports what it found.

Every repo script used to answer these itself, and the copies drifted: the
workspace directory list alone existed four times with three different contents.
Nothing here knows what any rule is; it hands rules their input.

## Language

**Workspace directory**:
A directory that _directly_ holds packages — `apps`, `packages/shared`,
`tooling`. Derived from the `packages:` globs in `pnpm-workspace.yaml` by
dropping the wildcard segment, never listed by hand.
_Avoid_: "layer" (a layer is a boundary tag in `turbo.json`, and the two sets
only look alike), "workspace root" (that is the repo root)

**Package** (`WorkspacePackage`):
A directory under a workspace directory holding a readable `package.json`,
carrying its absolute `dir`, its repo-relative `rel`, and the parsed `manifest`.
Its `name` is the manifest's, falling back to `rel` when it declares none, so a
message always has something to name. A directory with no manifest is not a
package and is skipped; a manifest that is not valid JSON is an error.
_Avoid_: "module", "workspace" (singular) for one of these

**Project** (`WorkspaceProject`):
A package as `pnpm ls` reports it — a name and a path, nothing read off disk. The
resolver's word for a member of a closure, kept distinct from **package** because
it carries no manifest.
_Avoid_: using it interchangeably with **package**

**Closure**:
The transitive workspace dependency set of one or more named packages,
development dependencies and tooling included. Asked of pnpm against the working
tree, so it is what the checkout's graph says right now.
_Avoid_: "dependency tree", "graph" for this specific set

**Token**:
What a human types to name a package: the full name (`@acme/nextjs`), the
unscoped tail (`nextjs`), or the directory (`nextjs-slim`). A token naming two
packages is refused rather than resolved to one of them.
_Avoid_: "alias", "short name" as a distinct concept — a short name is a token

**Declared infra**:
The union of `acme.infra` over a set of packages. Infra need travels with the
package that owns it, so a deployable's requirement is this union over its
closure and nothing is assumed on. The union is a _candidate_ set: pruning it for
services only needed under a given configuration belongs to the caller that can
read the authored development profiles.
_Avoid_: "the profile list" (a compose profile is what the caller does with the
answer), "required services"

**Violations** (`collectViolations`):
What a checker found, split into errors, which fail the run, and warnings, which
are reported and do not. A checker collects into one of these instead of printing
as it goes, so its output has a single shape.
_Avoid_: "issues", "problems" (the report renders them as problems; the
collection is violations)

**Report** (`formatReport`):
The stdout, stderr and exit code a set of violations produces — a value, so a
checker's output shape can be asserted without running it as a subprocess.
`reportAndExit` writes one and exits.
_Avoid_: "output", "summary" (the summary is the single clean-run line inside a
report)

## Relationships

- **Workspace directory** → **package**: one walk over the workspace directories
  discovers every package, reading each manifest once. Callers that used to walk
  the tree per rule share the one result.
- **Token** → **package**: resolution matches against discovered packages, so a
  token means the same thing to every command that takes one.
- **Package** → **closure** → **declared infra**: the closure query takes full
  names, not tokens, because that is pnpm's own filter vocabulary — resolve the
  token first.
- The bank (`scripts/lib/bank-closure.mjs`) reads the same workspace file and
  keeps its own copy of that reading. It runs from a bare checkout with nothing
  installed, so it cannot import this package.
- This package is consumed from source and has no build step: nothing builds
  `tooling/*` at install time.

## Decisions

See [`docs/adr/`](../../docs/adr/).
