# Dev-server + compose output mirrored to `logs/*.log` for agent consumption

**Status:** accepted — planning output, not yet built

The [Implementation handoff](#implementation-handoff) is the follow-on effort's
spec.

The agent cannot watch a live `pnpm dev`. Dev launch is `scripts/dev.sh` →
`turbo watch dev --continue` — a **foreground, full-screen TUI** (`ui: "tui"`,
task `persistent: false`) with no tty in the agent's shell; compose services run
detached and are only tailed on demand via `pnpm infra:logs`. So the agent's only
way to "see" dev output today is to start the dev server itself and read its
stream — which clashes with the human's TUI, competes for ports, and burns a live
process the agent then has to babysit.

This ADR decides a **log-capture convention**: while the human runs `pnpm dev`,
both dev-server output and compose-service output are mirrored to per-service
files under a root `logs/` dir, so the agent reads `logs/*.log` instead of ever
running the dev server itself. It is **planning output** — the wiring is not built
here; the [Implementation handoff](#implementation-handoff) is the executable
handoff for that follow-on effort.

Charted via the [dev-logs wayfinder map](https://github.com/regybean/Trellis/issues/147):
research [#148](https://github.com/regybean/Trellis/issues/148) (turbo dev-log
capture) and [#149](https://github.com/regybean/Trellis/issues/149) (podman
compose mirroring); prototype [#150](https://github.com/regybean/Trellis/issues/150)
(TUI-preserving dev capture); task [#155](https://github.com/regybean/Trellis/issues/155)
(turbo TUI pty behaviour); design tickets [#151](https://github.com/regybean/Trellis/issues/151)
(compose wiring/lifecycle), [#152](https://github.com/regybean/Trellis/issues/152)
(agent-facing convention), [#159](https://github.com/regybean/Trellis/issues/159)
(single-generation truncate ownership).

## Fixed constraints (set while charting)

- **Planning-only.** Output is this spec; no wiring built.
- **Turbo TUI is sacred.** The human `pnpm dev` interactive full-screen TUI must
  survive untouched — capture happens _alongside_ it, never by replacing it.
- **Single generation.** Exactly one current log per service — no rotation,
  history, or archive.
- **Prefer off-the-shelf** (turbo-native output, engine log follower) over a
  bespoke mechanism.

## Decision

### 1. The file contract — flat, single-generation, clean-text, dated

Both streams land as flat files in a root `logs/` dir (gitignored). The agent only
ever globs **`logs/*.log`** — no subdirs, and it never runs a live command.

- **Naming.** `logs/dev-<app>.log` (one per dev app: `dev-nextjs.log`,
  `dev-tanstack-start.log`, `dev-nextjs-slim.log`, `dev-tanstack-slim.log`) and
  `logs/infra-<svc>.log` (one per running compose service: `infra-postgres.log`,
  `infra-localstripe.log`, …). One service → one file.
- **Single generation + per-service truncate-on-start.** Each file holds only the
  current run. It is truncated once per `pnpm dev` session, at launch, and each
  truncate writes a **freshness header** as the first line:
  `# <label> started <ISO8601Z>` (e.g. `# dev-nextjs started 2026-07-28T09:12:03Z`),
  where `<label>` is `dev-<app>` / `infra-<svc>`. A subset run (`pnpm dev nextjs`)
  only refreshes the services it launches; every other file survives untouched as
  **stale-but-dated**.
- **Clean text.** Files are plain readable text — ANSI colour **and**
  cursor/carriage-return control noise (Next/Vite spinners) are stripped _before_
  the write. This gives one uniform clean-text contract across dev and infra files
  (`<engine> logs` output is already plain). The human's live TUI pane is a
  separate, untouched, still-coloured branch (see §2).

### 2. Dev-server capture — Path D: below turbo, per-app, TUI-preserving

Capture happens **below turbo**, inside each app's own `dev` script — _not_ at the
turbo layer. Turbo still receives each child's stream and paints the full-screen
TUI exactly as today; a source-level tee writes the file in parallel. This is the
only path that satisfies "TUI is sacred": turbo's own full-screen output is
un-tee-able ANSI (see [Considered and rejected](#considered-and-rejected)), so
capture must sit _beneath_ it.

- **PTY-wrap, not plain tee.** Empirically (real tty, turbo 2.7.5, [#155]) turbo
  under `ui: "tui"` hands each task a **pty**. A plain `tee` (pipe between the app
  and turbo) would make the app drop colour in the human's TUI pane — a
  regression. So the child is **pty-wrapped** (`script` / `unbuffer`) so turbo
  still sees a pty, and the captured branch is tee'd off and **ANSI-stripped**
  down to clean text (§1) before `>> logs/dev-<app>.log`.
- **Append-only below turbo.** The per-app wrapper writes with `>>` exclusively —
  it never truncates. File truncate + header are owned upstream by `dev.sh` (§4),
  so single-generation holds regardless of how `turbo watch` restarts a dev
  server on change.
- **`@acme/logger` (pino) file sink — considered, not primary.** A pino
  `multistream`/`transport` file sink is off-the-shelf and TUI-safe, but captures
  only what flows through `@acme/logger` — **not** the Next/Vite framework/compiler
  stdout (compile status, HMR, framework errors) the agent most needs. A possible
  complementary add-on, never a replacement for Path D.

### 3. Compose mirroring — one engine-log follower per running container

Compose output is mirrored by a **backgrounded `<engine> logs -f` follower per
running service**, addressed by container name:

```
<engine> logs -f --since "$START" trellis-<svc> >> logs/infra-<svc>.log 2>&1 &
```

- **Direct `<engine> logs`, not `compose logs`.** One container → one file, so we
  address the pinned `trellis-*` `container_name` directly. This drops the
  `--no-log-prefix` provider-version flag-floor risk (podman-compose #1355) — no
  per-line prefix is needed when each container has its own file.
- **`--since "$START"`** (RFC3339, `date -u`) suppresses the full-history replay
  that `logs -f` does on a reused container (infra containers are reused across
  sessions, never re-created).
- **Enumerate running services portably.** Use
  `<engine> ps --filter status=running --format '{{.Names}}'` ∩ the `trellis-`
  prefix — **not** `compose ps --status running` (podman-compose's `ps` lacks
  `--status`). Profile→container is 1:1 (`postgres → trellis-postgres`, … except
  `billing → trellis-localstripe`).
- **No `stdbuf`** (absent on the macOS base) — rely on `<engine> logs -f`'s
  per-line flush. Revisit only if buffering proves laggy (off-the-shelf first).

### 4. Lifecycle — capture is coextensive with a `pnpm dev` session

- **Runs under `pnpm dev` only.** Standalone `pnpm infra:up` never touches
  `logs/` (it exits immediately with no foreground owner to reap followers; a
  fresh header over an empty file would look live but be silent — an honestly-stale
  dated file is better). Standalone `turbo run dev -F …` / `pnpm preview` produce
  no capture either (see the gate below).
- **`dev.sh` loses its `exec`.** `exec turbo watch dev` replaces the shell, leaving
  nothing to hold a trap. The new sequence:
  1. `compose up -d --wait` (containers healthy before enumeration)
  2. `START=$(date -u +%Y-%m-%dT%H:%M:%SZ)` ; `mkdir -p logs`
  3. `prepare_log` for every launching **dev app** (truncate + header)
  4. per running `trellis-*`: `mirror_stream` (truncate + header + background
     follower, pushing its PID into a shared `pids[]`)
  5. one `trap 'kill "${pids[@]}" 2>/dev/null' EXIT INT TERM` — reaps **followers
     only**; infra containers stay up for `pnpm infra:down`
  6. `turbo watch dev` **foreground** — owns the tty/TUI, Ctrl-C and exit code all
     preserved (followers only write to files)
- **Truncate ownership → `dev.sh`, once per session.** `dev.sh` (already
  de-`exec`'d, already knows the launch set + naming, runs once) truncates +
  writes the header for both dev-app files and infra files, _before_ starting
  turbo. Truncate is a session concern, not a task-run concern; the below-turbo
  wrapper (§2) only appends. This dissolves the "re-truncate on turbo-watch
  restart?" question **by construction** — the file is never re-truncated
  mid-session whether or not turbo re-invokes the app `dev` script.
- **Capture gated on a `dev.sh`-exported env var (`DEV_LOG_DIR`).** The per-app
  wrapper tees only when it is set, and runs the dev command plain otherwise. This
  makes capture exactly coextensive with a `pnpm dev` session — no orphan or
  unheadered files from a bare `turbo run dev`/`preview`, keeping staleness
  detection (§6) clean.

### 5. The shared helper — `scripts/lib/dev-logs.sh`

A new library sourced by both `scripts/compose.sh` and `scripts/dev.sh`. The
genuine shared primitive is the **file-lifecycle contract** (identical header
shape), not the streaming (which legitimately differs: infra follower vs
below-turbo tee).

- `resolve_engine` — the engine-detection block **extracted** from `compose.sh`
  (which then sources it — identical behaviour, no drift).
- `prepare_log <label> <file>` — `: > file` then
  `printf '# %s started %s\n' <label> "$START"`. Called by `dev.sh` for **both**
  dev apps and infra services.
- `mirror_stream <label> <file> <cmd…>` — `prepare_log` + background follower
  (`"$@" >> file 2>&1 &`) + echo `$!`. **Infra-only.**
- `dev-log-path <slug>` — single-sources the `logs/dev-<slug>.log` path.
- Each app's `dev` script becomes `dev-capture <slug> <cmd…>` (the wrapper from
  §2): pty-wrap + ANSI-strip + append to `dev-log-path <slug>` when `DEV_LOG_DIR`
  is set, else run `<cmd…>` plain.

### 6. Agent-facing convention

- **`.gitignore`: `/logs/`** — root-anchored, whole dir; no `.gitkeep`
  (`dev.sh`'s `mkdir -p logs` recreates it each run; the agent only reads after a
  dev run populates it). The leading slash stops it matching stray nested `logs/`.
- **Two-tier docs.** A terse behavioural rule in `CLAUDE.md` points outward to a
  new **`docs/agents/dev-logs.md`** holding the full mechanics (the two streams,
  naming, header format, staleness rule, "files are plain text — ANSI stripped").
  This ADR references the doc; the doc is the operational how-to, mirroring the
  repo's `CLAUDE.md` → `docs/agents/*` split.
- **Prohibition scope — dev-observation-scoped.** The rule:

  > The human runs `pnpm dev`; its dev-server + infra output is mirrored to
  > `logs/*.log`. Read those instead of starting `pnpm dev` yourself to watch
  > output.

  It **supersedes** the current `CLAUDE.md` "on the primary checkout you may run
  [dev] to test" line _for observing dev output_, and is placed by **amending the
  Commands-area blockquote** (beside the allowance it supersedes), not the
  navigation protocol. It is **silent** on `preview` / `build` / `test` (out of
  scope, uncaptured — the agent still runs those normally) and does **not** ban
  `pnpm infra:up` for non-observation needs.

- **Staleness rule — relative, self-contained, zero tooling.** Read the header
  line first; the **newest** header across `logs/*.log` marks the last `pnpm dev`
  launch. A file with an **older** header (or none) was not part of that run →
  treat its contents as stale/not-live. One clarifier: file mtime advances while a
  service emits output, so **frozen mtime + current header = "live but idle,"** not
  stale.

## Considered and rejected

- **Turbo-native per-app dev log file** ([#148]). No such mechanism on 2.7.5:
  `.turbo/*.log` is a cache artifact for _cacheable_ tasks only, and the dev task
  is `cache: false` (writes nothing). A native `fileOutput` / `turbo logs` was
  proposed upstream but is unshipped.
- **Path B — drop the TUI, `--ui=stream` + line-prefix splitter** ([#148]/[#150]).
  Mechanically proven (the prefix `@acme/<app>:dev: <line>` parses cleanly), but
  it replaces the full-screen TUI with a plain scroll → violates "TUI is sacred."
- **Path C — per-app `turbo run dev -F <app>` tee'd.** Also loses the unified TUI
  _and_ reimplements watch orchestration.
- **Path A — double-run (human TUI + agent's own capture run).** Port clashes;
  impractical.
- **Plain `tee` below turbo** ([#155]). Turbo hands tasks a pty; a pipe makes the
  app drop colour in the human's TUI pane — a regression. Superseded by pty-wrap +
  ANSI-strip.
- **Direct container-driver log-file reads** ([#149]). podman defaults to
  `journald` (no file); docker's json-file driver is root-only. Rejected for a
  `<engine> logs -f` follower.
- **`compose logs` with `--no-log-prefix` / `compose ps --status`** ([#149]/[#151]).
  Both are non-portable across podman-compose versions; direct
  `<engine> logs`/`<engine> ps` sidesteps both.

## Implementation handoff

Concrete wiring points for the build effort:

1. **`scripts/lib/dev-logs.sh`** (new) — `resolve_engine` (extracted from
   `compose.sh`), `prepare_log`, `mirror_stream`, `dev-log-path`, and the
   `dev-capture` wrapper (pty-wrap + ANSI-strip + gated append).
2. **`scripts/compose.sh`** — source `dev-logs.sh` for `resolve_engine`; otherwise
   unchanged (stays a pure engine passthrough, also used by tests/preview/infra:up).
3. **`scripts/dev.sh`** — drop both `exec turbo watch dev` lines; export
   `DEV_LOG_DIR`; run the §4 sequence (prepare dev-app logs → enumerate running
   `trellis-*` + `mirror_stream` each → single trap → `turbo watch dev`
   foreground, propagating its exit code).
4. **`scripts/resolve-infra.ts`** — extend to always emit the **full app list**
   (fixing the current `app_names=""` all-apps blind spot in `dev.sh`), so
   `prepare_log` covers every app turbo will start.
5. **Each app's `dev` script** (`apps/*/package.json`) — wrap the dev command in
   `dev-capture <slug> …`.
6. **`.gitignore`** — add `/logs/`.
7. **Docs** — new `docs/agents/dev-logs.md`; amend the `CLAUDE.md` Commands-area
   blockquote with the dev-observation prohibition pointing at it.

## Consequences

- A new `scripts/lib/dev-logs.sh` and a modified `dev.sh` (loses `exec`, gains the
  follower/trap sequence); `compose.sh` gains only a `source` for `resolve_engine`.
- Each app's `dev` script is wrapped once; no per-app divergence.
- The agent reads `logs/*.log` for dev/infra output and no longer starts `pnpm dev`
  to observe it — one clean-text, single-generation, dated contract.
- The human's `pnpm dev` TUI is unchanged (capture is below turbo, followers only
  write to files, `dev.sh` runs turbo in the foreground).
- Out of scope (never captured): `pnpm test` / `preview` / `build` output, CI
  logs, and log capture inside git worktrees (dev/infra are manual-only there).
