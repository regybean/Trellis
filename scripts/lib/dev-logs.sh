#!/usr/bin/env bash
# Shared library for dev/compose log capture (ADR 0028).
#
# Dual-mode: `compose.sh`/`dev.sh` SOURCE it for the functions; each app's
# package.json `dev` script EXECUTES it as `dev-logs.sh dev-capture <slug> …`
# (the dispatch guard at the bottom runs the named function). Sourcing skips the
# guard, so callers just get the functions.
#
# The genuine shared primitive is the file-lifecycle contract (identical header
# shape across dev + infra files): `prepare_log` owns truncate + freshness
# header; `mirror_stream` adds the infra follower on top. `resolve_engine`
# (extracted from compose.sh) keeps engine detection identical across both. The
# dev-server branch is `dev-capture` (§2): pty-wrap + ANSI-strip + append.

# resolve_engine — echo the container engine to use.
# Honours CONTAINER_ENGINE override; else docker if usable, else podman, else
# fails (return 1). Identical logic to the block previously inlined in compose.sh.
resolve_engine() {
  local engine="${CONTAINER_ENGINE:-}"

  if [ -z "$engine" ]; then
    if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
      engine=docker
    elif command -v podman >/dev/null 2>&1; then
      engine=podman
    else
      echo "resolve_engine: no usable container engine found (need docker or podman)." >&2
      return 1
    fi
  fi

  printf '%s\n' "$engine"
}

# prepare_log <label> <file> — start a fresh single-generation log: truncate
# <file>, then write the dated freshness header `# <label> started <ISO8601Z>` as
# line 1. The timestamp is single-sourced from $START (set once per pnpm dev
# session by dev.sh), so every file from one launch shares the same instant and
# the newest header across logs/*.log marks that launch (ADR 0028 §1, §6).
prepare_log() {
  local label="$1" file="$2"
  : >"$file"
  printf '# %s started %s\n' "$label" "$START" >>"$file"
}

# mirror_stream <label> <file> <cmd…> — prepare_log, then run <cmd…> as a
# backgrounded follower appending its stdout+stderr to <file>. Echoes the
# follower PID so the caller can collect it for the reap trap. Infra-only: the
# dev-server branch appends below turbo instead (ADR 0028 §2, §5).
mirror_stream() {
  local label="$1" file="$2"
  shift 2
  prepare_log "$label" "$file"
  "$@" >>"$file" 2>&1 &
  printf '%s\n' "$!"
}

# dev-log-path <slug> — single-source the dev-server log path for <slug>. Used by
# dev.sh (to prepare_log it once per session) and by dev-capture (to append to
# the same file), so the truncate and the append can never disagree. Anchored on
# $DEV_LOG_DIR (absolute, exported by dev.sh) so it resolves identically whatever
# the caller's cwd — turbo runs each app's `dev` script from the app dir.
dev-log-path() {
  printf '%s/dev-%s.log\n' "${DEV_LOG_DIR:-logs}" "$1"
}

# _dev_ansi_strip — filter turning a raw pty capture into clean readable text
# (ADR 0028 §1): drop CSI colour/cursor escapes and OSC title sets, fold the
# CRLF pty line ending to LF, and collapse carriage-return spinner frames
# (Next/Vite) to their final rendered frame. Autoflushed ($|=1) so the file
# stays live for the agent. perl (present on macOS + CI) handles \e/\a portably —
# BSD sed has no \xNN escape.
_dev_ansi_strip() {
  perl -pe 'BEGIN { $| = 1 }
    s/\e\[[0-9;?]*[ -\/]*[@-~]//g;    # CSI: colour, cursor moves, erase-line
    s/\e\][^\a\e]*(?:\a|\e\\)//g;     # OSC: window/tab title sets
    s/\r$//;                          # CRLF pty line ending -> LF
    s/.*\r//;                         # spinner frames -> last one wins'
}

# _dev_pty_wrap <cmd…> — run <cmd…> under a pseudo-tty so it still detects a
# terminal and emits colour, echoing its combined output to stdout. `script` is
# always present but its CLI diverges: BSD (macOS) takes the command as trailing
# args after the typescript file; util-linux needs it as a single -c string
# (-f flush live, -e propagate the child exit code, -q quiet). /dev/null discards
# the raw typescript — the clean copy is tee'd off downstream.
_dev_pty_wrap() {
  if [ "$(uname)" = Darwin ]; then
    script -q /dev/null "$@"
  else
    local cmd
    cmd="$(printf '%q ' "$@")"
    script -qfe -c "$cmd" /dev/null
  fi
}

# dev-capture <slug> <cmd…> — the §2 below-turbo dev-server wrapper. Ungated
# (no DEV_LOG_DIR, i.e. bare `turbo run dev`/`preview`): run <cmd…> plain, no
# capture. Gated (under `pnpm dev`): tee a clean-text copy to dev-log-path <slug>
# (append-only — dev.sh owns the once-per-session truncate) while passing the
# stream through untouched. When stdout is a real tty (turbo's TUI pane),
# pty-wrap so colour survives in the human's pane; otherwise (agent/CI, no tty)
# there is no colour to preserve, so capture over a plain pipe.
dev-capture() {
  local slug="$1"
  shift
  if [ -z "${DEV_LOG_DIR:-}" ]; then
    exec "$@"
  fi
  local file
  file="$(dev-log-path "$slug")"
  if [ -t 1 ]; then
    _dev_pty_wrap "$@" | tee >(_dev_ansi_strip >>"$file")
  else
    "$@" 2>&1 | tee >(_dev_ansi_strip >>"$file")
  fi
}

# Dispatch guard: when executed directly (app `dev` script), run the named
# function; when sourced (dev.sh/compose.sh), do nothing and just export the
# functions. `set -e` is deliberately omitted — a dev server's non-zero exit must
# reach turbo unaltered through the tee pipeline, not trip an early bash exit.
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  set -uo pipefail
  "$@"
fi
