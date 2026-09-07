/**
 * The whole tool, end to end, against LocalStack's Secrets Manager: `env:push`
 * stores only the secret keys, `env:pull` rebuilds the `.env` from the example
 * (non-secrets) merged with the vault (secrets).
 *
 * It drives the real `scripts/env-*.sh` — the shell, the backend dispatch and
 * the `aws` adapter included — because that composition is the contract, and
 * the defects this package was extracted to fix all lived in the seam between
 * the shell and the logic. The `aws` CLI (used by the adapter and by the
 * assertions here) ships on the local machine and on CI runners.
 *
 * Nothing in the repo is touched: a sandbox directory holds the `.env`, and a
 * `SECRETS_CONFIG` of its own points the run at it by absolute path.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
// src/tests/backend/integration/service -> repo root is seven levels up.
const repoRoot = resolve(here, '../../../../../../../');

const awsEnv = {
  ...process.env,
  AWS_ENDPOINT_URL: inject('infraEnv').AWS_ENDPOINT_URL,
  AWS_ACCESS_KEY_ID: 'test',
  AWS_SECRET_ACCESS_KEY: 'test',
  AWS_REGION: 'us-east-1',
  SECRETS_BACKEND: 'aws',
};

let sandbox: string;
let envFile: string;

function runScript(name: string) {
  execFileSync('bash', [join(repoRoot, 'scripts', name)], {
    cwd: repoRoot,
    env: { ...awsEnv, SECRETS_CONFIG: join(sandbox, 'secrets.config.sh') },
    stdio: 'pipe',
  });
}

function aws(args: string[]): string {
  return execFileSync('aws', args, { env: awsEnv, encoding: 'utf8' });
}

function storedSecret(): Record<string, string> {
  return JSON.parse(
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
}

beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'secrets-sync-'));
  envFile = join(sandbox, '.env');
  writeFileSync(
    join(sandbox, 'secrets.config.sh'),
    `SECRETS_BACKEND="\${SECRETS_BACKEND:-aws}"\nSECRET_MAP=( "${SECRET_NAME}:${envFile}" )\n`,
  );
  writeFileSync(
    `${envFile}.example`,
    'PUBLIC_URL=http://localhost:3000\nDB_PORT=5432\nNEXT_PUBLIC_TOKEN=\nAPI_SECRET=\nPRIVATE_KEY=\n',
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
      envFile,
      [
        'PUBLIC_URL=http://localhost:3000',
        'DB_PORT=5432',
        'NEXT_PUBLIC_TOKEN=pk_public_value',
        'API_SECRET=super-secret-value',
        'PRIVATE_KEY=',
        '',
      ].join('\n'),
    );

    runScript('env-push.sh');

    // Only the empty-in-example, non-NEXT_PUBLIC_ keys are secret.
    const stored = storedSecret();
    expect(Object.keys(stored).sort()).toEqual(['API_SECRET', 'PRIVATE_KEY']);
    expect(stored.API_SECRET).toBe('super-secret-value');

    // Pull into a clean slate and assert the round-trip.
    rmSync(envFile);
    runScript('env-pull.sh');
    const rebuilt = readFileSync(envFile, 'utf8');

    expect(rebuilt).toMatch(/^PUBLIC_URL=http:\/\/localhost:3000$/m); // non-secret from example
    expect(rebuilt).toMatch(/^DB_PORT=5432$/m); // non-secret from example
    expect(rebuilt).toMatch(/^API_SECRET=super-secret-value$/m); // secret from vault
    expect(rebuilt).toMatch(/^NEXT_PUBLIC_TOKEN=$/m); // non-secret, stayed empty
  });

  it('round-trips a secret whose value contains a newline', () => {
    const key = [
      '-----BEGIN KEY-----',
      'bWFkZSB1cA==',
      '-----END KEY-----',
    ].join('\n');
    writeFileSync(
      envFile,
      [
        'PUBLIC_URL=http://localhost:3000',
        'DB_PORT=5432',
        'NEXT_PUBLIC_TOKEN=',
        'API_SECRET=super-secret-value',
        `PRIVATE_KEY="${key.replaceAll('\n', '\\n')}"`,
        '',
      ].join('\n'),
    );

    runScript('env-push.sh');
    expect(storedSecret().PRIVATE_KEY).toBe(key);

    rmSync(envFile);
    runScript('env-pull.sh');

    // Back through the file: the value the vault holds is the value we started
    // with, and it survives being written out and read in again.
    runScript('env-push.sh');
    expect(storedSecret().PRIVATE_KEY).toBe(key);
  });

  it('is idempotent: pulling twice writes the same file', () => {
    writeFileSync(
      envFile,
      [
        'PUBLIC_URL=http://localhost:3000',
        'DB_PORT=5432',
        'NEXT_PUBLIC_TOKEN=',
        'API_SECRET=super-secret-value',
        'PRIVATE_KEY=',
        '',
      ].join('\n'),
    );
    runScript('env-push.sh');
    runScript('env-pull.sh');

    const first = readFileSync(envFile, 'utf8');
    runScript('env-pull.sh');

    expect(readFileSync(envFile, 'utf8')).toBe(first);
    expect(first).toMatch(/^PRIVATE_KEY=$/m);
  });
});
