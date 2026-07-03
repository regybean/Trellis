/**
 * Verifies the `aws` secrets backend round-trips against LocalStack's Secrets
 * Manager: env:push stores only the secret keys, env:pull rebuilds the .env
 * from the example (non-secrets) merged with the vault (secrets).
 *
 * The env scripts are root-level bash; we exercise them in a throwaway sandbox
 * so the real repo .env files are never touched. The `aws` CLI (used by the
 * adapter and the assertions) ships on the local machine and on CI runners.
 */

import { execFileSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  inject,
  it,
} from 'vitest';

const SECRET_NAME = 'secrets-sync-test';
const here = dirname(fileURLToPath(import.meta.url));
// src/tests/backend -> repo root is five levels up.
const repoRoot = resolve(here, '../../../../../');
const scriptsDir = join(repoRoot, 'scripts');

const awsEnv = {
  ...process.env,
  AWS_ENDPOINT_URL: inject('infraEnv').AWS_ENDPOINT_URL,
  AWS_ACCESS_KEY_ID: 'test',
  AWS_SECRET_ACCESS_KEY: 'test',
  AWS_REGION: 'us-east-1',
  SECRETS_BACKEND: 'aws',
};

let sandbox: string;

function runScript(name: string) {
  execFileSync('bash', [join('scripts', name)], {
    cwd: sandbox,
    env: awsEnv,
    stdio: 'pipe',
  });
}

function aws(args: string[]): string {
  return execFileSync('aws', args, { env: awsEnv, encoding: 'utf8' });
}

beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'secrets-sync-'));
  mkdirSync(join(sandbox, 'scripts'));
  cpSync(
    join(scriptsDir, 'secrets-backends'),
    join(sandbox, 'scripts/secrets-backends'),
    {
      recursive: true,
    },
  );
  cpSync(join(scriptsDir, 'env-pull.sh'), join(sandbox, 'scripts/env-pull.sh'));
  cpSync(join(scriptsDir, 'env-push.sh'), join(sandbox, 'scripts/env-push.sh'));
  writeFileSync(
    join(sandbox, 'secrets.config.sh'),
    `SECRETS_BACKEND="\${SECRETS_BACKEND:-aws}"\nSECRET_MAP=( "${SECRET_NAME}:.env" )\n`,
  );
  writeFileSync(
    join(sandbox, '.env.example'),
    'PUBLIC_URL=http://localhost:3000\nDB_PORT=5432\nNEXT_PUBLIC_TOKEN=\nAPI_SECRET=\n',
  );
});

afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

beforeEach(() => {
  // Force-delete so each run starts from no secret (otherwise create-secret
  // fails on a soft-deleted name, and stale keys would trigger merge prompts).
  try {
    aws([
      'secretsmanager',
      'delete-secret',
      '--secret-id',
      SECRET_NAME,
      '--force-delete-without-recovery',
    ]);
  } catch {
    // not present yet — fine
  }
});

describe('aws secrets backend against LocalStack', () => {
  it('pushes only secrets, then pull rebuilds .env from example + vault', () => {
    // A developer's filled .env: non-secrets from the example + real secrets.
    writeFileSync(
      join(sandbox, '.env'),
      [
        'PUBLIC_URL=http://localhost:3000',
        'DB_PORT=5432',
        'NEXT_PUBLIC_TOKEN=pk_public_value',
        'API_SECRET=super-secret-value',
        '',
      ].join('\n'),
    );

    runScript('env-push.sh');

    const stored = JSON.parse(
      aws([
        'secretsmanager',
        'get-secret-value',
        '--secret-id',
        SECRET_NAME,
        '--query',
        'SecretString',
        '--output',
        'text',
      ]).trim(),
    ) as Record<string, string>;

    // Only the empty-in-example, non-NEXT_PUBLIC_ key is a secret.
    expect(Object.keys(stored).sort()).toEqual(['API_SECRET']);
    expect(stored.API_SECRET).toBe('super-secret-value');

    // Pull into a clean slate and assert the round-trip.
    rmSync(join(sandbox, '.env'));
    runScript('env-pull.sh');
    const rebuilt = readFileSync(join(sandbox, '.env'), 'utf8');

    expect(rebuilt).toMatch(/^PUBLIC_URL=http:\/\/localhost:3000$/m); // non-secret from example
    expect(rebuilt).toMatch(/^DB_PORT=5432$/m); // non-secret from example
    expect(rebuilt).toMatch(/^API_SECRET=super-secret-value$/m); // secret from vault
    expect(rebuilt).toMatch(/^NEXT_PUBLIC_TOKEN=$/m); // non-secret, stayed empty
  });
});
