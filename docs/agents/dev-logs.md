# Dev + infra logs — reading `logs/*.log`

The agent can't watch a live `pnpm dev` (it's a foreground full-screen TUI with no
tty in the agent's shell). Instead, while the **human** runs `pnpm dev`, both the
dev-server output and the compose-service output are mirrored to plain-text files
under a root `logs/` dir. **Read those instead of starting `pnpm dev` yourself to
watch output.** The mechanism is [ADR 0028](../adr/0028-dev-and-compose-logs-mirrored-to-files-for-the-agent.md);
this is the operational how-to.

Glob **`logs/*.log`** — flat dir, no subdirs. `logs/` is gitignored and recreated
by `dev.sh` on each `pnpm dev`, so it only exists after a dev run.

## The two streams

- **`logs/dev-<app>.log`** — one per dev app: `dev-nextjs.log`,
  `dev-tanstack-start.log`, `dev-nextjs-slim.log`, `dev-tanstack-slim.log`. The
  framework/compiler stdout (compile status, HMR, framework errors) plus anything
  the app logs.
- **`logs/infra-<svc>.log`** — one per running compose service, e.g.
  `infra-postgres.log`, `infra-redis.log`, `infra-localstripe.log`,
  `infra-ollama.log`, `infra-jaeger.log`, `infra-localstack.log`. One container →
  one file.

One service → one file; single generation (no rotation, history, or archive) —
each file holds only the current run.

## Freshness header

The first line of every file is a dated freshness header:

```
# <label> started <ISO8601Z>
```

where `<label>` is `dev-<app>` / `infra-<svc>` — e.g.
`# dev-nextjs started 2026-07-28T19:58:20Z`. Every file from one `pnpm dev` launch
shares the same instant (it's single-sourced from the session start time), so the
header is what tells you which launch a file belongs to.

## Staleness rule

Relative, self-contained, zero tooling — **read the header line first**:

1. The **newest** header across `logs/*.log` marks the last `pnpm dev` launch.
2. A file with an **older** header (or none) was not part of that run → treat its
   contents as **stale / not-live**. A subset run (`pnpm dev nextjs`) only
   refreshes the apps it launches; every other file survives untouched as
   stale-but-dated.

Clarifier: file mtime advances only while a service emits output, so a **frozen
mtime + current header = "live but idle"**, not stale — the service is up, it just
hasn't logged since.

## Clean text — ANSI stripped

Files are plain readable text. ANSI colour **and** cursor/carriage-return control
noise (Next/Vite spinners) are stripped before the write, giving one uniform
clean-text contract across dev and infra files. The human's live `pnpm dev` TUI
pane is a separate, still-coloured branch — untouched by this.

## Scope — when capture happens

Capture is coextensive with a `pnpm dev` session and nothing else:

- **Only under `pnpm dev`.** Standalone `pnpm infra:up` never touches `logs/`;
  bare `turbo run dev` / `pnpm preview` / `pnpm build` / `pnpm test` produce no
  capture either.
- So `logs/*.log` reflects dev/infra output only. For the uncaptured commands
  (`preview` / `build` / `test`), run them yourself as normal — this convention
  doesn't cover them, and it doesn't ban `pnpm infra:up` for non-observation needs.
