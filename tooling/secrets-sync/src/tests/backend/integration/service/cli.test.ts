/**
 * The CLI as the shell scripts see it: exit codes, the shape of each output,
 * and the refusals. That is the contract of a command-line program, so it is
 * exercised as one — the rules underneath have their own unit tests.
 *
 * The prompt blocks matter most here. The shell decides whether to ask by
 * testing whether the block is empty, so "reported as unchanged" and "written
 * as an empty file" are the same statement.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
// src/tests/backend/integration/service -> repo root is seven levels up.
const repoRoot = resolve(here, '../../../../../../../');
const cli = join(repoRoot, 'tooling/secrets-sync/src/cli.ts');

const EXAMPLE = [
  'PUBLIC_URL=http://localhost:3000',
  'DB_PORT=5432',
  'NEXT_PUBLIC_TOKEN=',
  'API_SECRET=',
  'PRIVATE_KEY=',
  '',
].join('\n');

let dir: string;

interface Run {
  status: number;
  stdout: string;
  stderr: string;
}

function run(args: string[]): Run {
  const result = spawnSync('pnpm', ['exec', 'tsx', cli, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

/** Write the three inputs a pull works from, and plan against them. */
function planPull({
  env,
  vault,
}: {
  env: string;
  vault: Record<string, string>;
}): {
  extras: string;
  differing: string;
  result: Run;
} {
  writeFileSync(join(dir, '.env'), env);
  writeFileSync(join(dir, 'vault.json'), JSON.stringify(vault));
  const result = run([
    'plan-pull',
    '--example',
    join(dir, '.env.example'),
    '--env',
    join(dir, '.env'),
    '--vault',
    join(dir, 'vault.json'),
    '--extras-out',
    join(dir, 'extras'),
    '--differing-out',
    join(dir, 'differing'),
  ]);
  return {
    extras: readFileSync(join(dir, 'extras'), 'utf8'),
    differing: readFileSync(join(dir, 'differing'), 'utf8'),
    result,
  };
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'secrets-cli-'));
  writeFileSync(join(dir, '.env.example'), EXAMPLE);
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('plan-pull', () => {
  it('reports nothing when the file already holds what the vault composes to', () => {
    const { extras, differing, result } = planPull({
      env: 'PUBLIC_URL=http://localhost:3000\nDB_PORT=5432\nNEXT_PUBLIC_TOKEN=\nAPI_SECRET=filled\nPRIVATE_KEY=\n',
      vault: { API_SECRET: 'filled' },
    });
    expect(result.status).toBe(0);
    expect(extras).toBe('');
    // PRIVATE_KEY is empty on both sides. It used to report as differing here
    // on every run, because absence and emptiness read as the same value.
    expect(differing).toBe('');
  });

  it('reports a differing key with both values, local first', () => {
    const { differing } = planPull({
      env: 'API_SECRET=stale\n',
      vault: { API_SECRET: 'fresh' },
    });
    expect(differing).toBe(
      '  API_SECRET\n    Local:  stale\n    Remote: fresh\n',
    );
  });

  it('reports the keys only the local file holds', () => {
    const { extras } = planPull({
      env: 'API_SECRET=filled\nSCRATCH=mine\n',
      vault: { API_SECRET: 'filled' },
    });
    expect(extras).toBe('  - SCRATCH\n');
  });
});

describe('apply-pull', () => {
  function applyPull(flags: string[]) {
    writeFileSync(join(dir, '.env'), 'API_SECRET=local\nSCRATCH=mine\n');
    writeFileSync(
      join(dir, 'vault.json'),
      JSON.stringify({ API_SECRET: 'remote' }),
    );
    return run([
      'apply-pull',
      '--example',
      join(dir, '.env.example'),
      '--env',
      join(dir, '.env'),
      '--vault',
      join(dir, 'vault.json'),
      ...flags,
    ]).stdout;
  }

  it('takes the vault values and drops local-only keys by default', () => {
    const out = applyPull(['--prefer-source']);
    expect(out).toMatch(/^API_SECRET=remote$/m);
    expect(out).not.toMatch(/^SCRATCH=/m);
  });

  it('keeps local-only keys when asked', () => {
    expect(applyPull(['--prefer-source', '--keep-extra'])).toMatch(
      /^SCRATCH=mine$/m,
    );
  });

  it('keeps local values when asked, and still adds new keys', () => {
    const out = applyPull([]);
    expect(out).toMatch(/^API_SECRET=local$/m);
    expect(out).toMatch(/^PUBLIC_URL=http:\/\/localhost:3000$/m);
  });

  it('falls back to vault-only when there is no example, and says so', () => {
    writeFileSync(
      join(dir, 'vault.json'),
      JSON.stringify({ 'ODD"KEY': 'value' }),
    );
    const result = run([
      'apply-pull',
      '--example',
      join(dir, 'nothing-here.example'),
      '--env',
      join(dir, 'nothing-here'),
      '--vault',
      join(dir, 'vault.json'),
      '--prefer-source',
    ]);
    // A vault key is data, whatever characters it holds: no crash, no refusal.
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('ODD"KEY');
    expect(result.stderr).toContain('using vault values only');
  });
});

describe('payload-push', () => {
  it('sends the secrets only, and warns about an undeclared key', () => {
    writeFileSync(
      join(dir, '.env'),
      'PUBLIC_URL=http://localhost:3000\nAPI_SECRET=s3cret\nNEXT_PUBLIC_TOKEN=pk\nSCRATCH=mine\n',
    );
    const result = run([
      'payload-push',
      '--example',
      join(dir, '.env.example'),
      '--env',
      join(dir, '.env'),
    ]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ API_SECRET: 's3cret' });
    expect(result.stderr).toContain('SCRATCH');
    expect(result.stderr).toContain('not pushed');
  });

  it('refuses without an example — nothing can be classified', () => {
    const result = run([
      'payload-push',
      '--example',
      join(dir, 'absent.example'),
      '--env',
      join(dir, '.env'),
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'required to classify which keys are secret',
    );
  });
});

describe('the command itself', () => {
  it('refuses an unknown command with usage', () => {
    const result = run(['frobnicate']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Unknown command 'frobnicate'");
    expect(result.stderr).toContain('Usage: secrets-sync');
  });

  it('refuses a missing required argument by name', () => {
    const result = run(['payload-push', '--env', join(dir, '.env')]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('--example is required');
  });
});
