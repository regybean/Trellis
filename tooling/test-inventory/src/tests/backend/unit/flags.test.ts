/**
 * The command line, asserted as a function over an argv.
 *
 * Parsing used to read `process.argv` and exit from inside itself, so "what
 * does this argv mean" could only be answered by launching the whole tool. It
 * returns a result now, and these are the answers: what is a target, what is a
 * filter, and what makes the run a usage error before anything is collected.
 */
import { describe, expect, it } from 'vitest';

import { parseArguments } from '../../../flags';

/** The parse, or the message it refused with — whichever the case is about. */
function parsed(...argv: string[]) {
  const result = parseArguments(argv);
  if (!result.ok) throw new Error(`refused: ${result.message}`);
  return result.args;
}

describe('the argv names the targets', () => {
  it('reads the positionals as package or app tokens', () => {
    expect(parsed('@acme/chat', 'nextjs-slim').targets).toEqual([
      '@acme/chat',
      'nextjs-slim',
    ]);
  });

  it('takes no target to mean every package', () => {
    expect(parsed().targets).toEqual([]);
  });

  it('reads the separator pnpm forwards as no argument at all', () => {
    expect(parsed('--', '--kind', 'unit')).toEqual(parsed('--kind', 'unit'));
  });

  it('reads that separator between a target and a flag too', () => {
    // `pnpm test:inventory chat -- --kind unit` puts it mid-argv, where
    // parseArgs would otherwise read the flags after it as more targets.
    expect(parsed('chat', '--', '--kind', 'unit').targets).toEqual(['chat']);
  });
});

describe('the argv narrows the report', () => {
  it('leaves an unset axis undefined, which means everything', () => {
    expect(parsed().filters).toEqual({ layer: undefined, kind: undefined });
  });

  it('reads a comma-separated list as every name in it', () => {
    expect(parsed('--kind', 'unit,integration').filters.kind).toEqual(
      new Set(['unit', 'integration']),
    );
  });

  it('reads a repeated flag as the same set', () => {
    expect(parsed('--kind', 'unit', '--kind', 'integration').filters).toEqual(
      parsed('--kind', 'unit,integration').filters,
    );
  });

  it('takes --flag=value, as stdlib parsing does', () => {
    expect(parsed('--layer=backend').filters.layer).toEqual(
      new Set(['backend']),
    );
  });

  it('takes the two axes together', () => {
    const { filters } = parsed('--layer', 'backend', '--kind', 'unit');
    expect(filters).toEqual({
      layer: new Set(['backend']),
      kind: new Set(['unit']),
    });
  });

  it('reads --out as the file to write, and nothing as stdout', () => {
    expect(parsed('--out', 'inventory.md').out).toBe('inventory.md');
    expect(parsed().out).toBeUndefined();
  });
});

describe('the argv can be a usage error', () => {
  it('refuses a flag nobody declared, naming it', () => {
    const result = parseArguments(['--group', 'api']);
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.message).toContain('--group');
  });

  it('refuses a value-taking flag with no value', () => {
    expect(parseArguments(['--out']).ok).toBe(false);
  });

  it('says so as a returned result, not by exiting', () => {
    // The whole point: a bad argv is a value the caller can inspect. If parsing
    // exited, this test could not run at all.
    expect(parseArguments(['--nope'])).toMatchObject({ ok: false });
  });
});
