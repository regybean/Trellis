/**
 * The command line: targets, the two filter axes and `--out`.
 *
 * Parsing returns a result and the caller decides what to do with it. It used
 * to read `process.argv` and call `process.exit` from inside the parser, which
 * made "what does this argv mean" a question only a subprocess could answer —
 * for a function whose whole job is turning strings into a value.
 */
import { parseArgs } from 'node:util';

import type { Filters } from './render';

export const USAGE =
  'Usage: pnpm test:inventory [package|app ...] [--layer <names>] [--kind <names>] [--out <path>]';

export interface InventoryArgs {
  /** The package/app tokens, left for `expandTargets` to resolve. */
  readonly targets: string[];
  readonly filters: Filters;
  /** Where to write the report; unset means stdout. */
  readonly out?: string;
}

/** Either what the argv meant, or why it meant nothing. */
export type ParsedArgs =
  | { readonly ok: true; readonly args: InventoryArgs }
  | { readonly ok: false; readonly message: string };

/**
 * One axis's selection. `a,b` and a repeated flag both mean the same set, so a
 * generated invocation can build it up either way; unset means everything.
 */
function selection(values: string[] | undefined) {
  const names = (values ?? []).flatMap((value) => value.split(','));
  return names.length === 0 ? undefined : new Set(names);
}

/**
 * The targets and flags, off `node:util`'s `parseArgs` — `--flag=value`, a
 * repeated flag and rejecting one nobody declared are all its behaviour, and it
 * is stdlib. Its errors are `TypeError`s aimed at the caller, so they come back
 * as the same phrased-for-a-human refusal as before.
 */
export function parseArguments(argv: readonly string[]): ParsedArgs {
  // `pnpm test:inventory <app> -- --kind unit` forwards the separator too, and
  // parseArgs reads a bare `--` as "everything after this is positional" —
  // which would turn the flags into targets. No target and no flag value is
  // ever `--`, so drop every one of them.
  const args = argv.filter((arg) => arg !== '--');
  try {
    const { values, positionals } = parseArgs({
      args: [...args],
      allowPositionals: true,
      options: {
        layer: { type: 'string', multiple: true },
        kind: { type: 'string', multiple: true },
        out: { type: 'string' },
      },
    });
    return {
      ok: true,
      args: {
        targets: positionals,
        filters: {
          layer: selection(values.layer),
          kind: selection(values.kind),
        },
        out: values.out,
      },
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
