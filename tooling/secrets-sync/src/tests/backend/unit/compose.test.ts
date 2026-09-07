/**
 * The two directions: what a `.env` should hold, and what a push may send.
 */
import { describe, expect, it } from 'vitest';

import { composeDesired, sensitiveOnly } from '../../../compose';
import { parseEnvFile } from '../../../dotenv';

const example = parseEnvFile(
  [
    'PUBLIC_URL=http://localhost:3000',
    'DB_PORT=5432',
    'NEXT_PUBLIC_TOKEN=',
    'API_SECRET=',
    '',
  ].join('\n'),
);

describe('composeDesired', () => {
  it('takes non-secrets from the example and secrets from the vault', () => {
    expect(
      composeDesired({ example, vault: { API_SECRET: 'from-vault' } }),
    ).toEqual({
      PUBLIC_URL: 'http://localhost:3000',
      DB_PORT: '5432',
      NEXT_PUBLIC_TOKEN: '',
      API_SECRET: 'from-vault',
    });
  });

  it('leaves a secret the vault does not hold empty rather than dropping it', () => {
    expect(composeDesired({ example, vault: {} }).API_SECRET).toBe('');
  });

  it('ignores a vault key the example does not declare', () => {
    const desired = composeDesired({ example, vault: { STOWAWAY: 'x' } });
    expect('STOWAWAY' in desired).toBe(false);
  });

  it('never lets the vault override a non-secret', () => {
    expect(
      composeDesired({
        example,
        vault: { PUBLIC_URL: 'http://evil', NEXT_PUBLIC_TOKEN: 'pk' },
      }),
    ).toMatchObject({
      PUBLIC_URL: 'http://localhost:3000',
      NEXT_PUBLIC_TOKEN: '',
    });
  });

  it('keeps example order', () => {
    expect(Object.keys(composeDesired({ example, vault: {} }))).toEqual(
      Object.keys(example),
    );
  });
});

describe('sensitiveOnly', () => {
  const local = parseEnvFile(
    [
      'PUBLIC_URL=http://localhost:3000',
      'DB_PORT=5432',
      'NEXT_PUBLIC_TOKEN=pk_public_value',
      'API_SECRET=super-secret-value',
      '',
    ].join('\n'),
  );

  it('sends the secrets and nothing else', () => {
    expect(sensitiveOnly({ example, local }).payload).toEqual({
      API_SECRET: 'super-secret-value',
    });
  });

  it('reports an undeclared local key instead of pushing it', () => {
    const { payload, undeclared } = sensitiveOnly({
      example,
      local: { ...local, SCRATCH: 'local experiment' },
    });
    expect(undeclared).toEqual(['SCRATCH']);
    expect('SCRATCH' in payload).toBe(false);
  });

  it('sends a secret the developer has left empty', () => {
    expect(
      sensitiveOnly({ example, local: { API_SECRET: '' } }).payload,
    ).toEqual({
      API_SECRET: '',
    });
  });
});
