/**
 * `<file>.example` is the contract (ADR 0001) — and both directions ask this
 * module, so pull and push cannot disagree about what a secret is.
 */
import { describe, expect, it } from 'vitest';

import { isSecretKey, secretKeys } from '../../../classify';
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

describe('isSecretKey', () => {
  it('is true for a key the example declares empty', () => {
    expect(isSecretKey('API_SECRET', example)).toBe(true);
  });

  it('is false for a key the example gives a value', () => {
    expect(isSecretKey('PUBLIC_URL', example)).toBe(false);
  });

  it('is false for an empty NEXT_PUBLIC_ key — it reaches the browser', () => {
    expect(isSecretKey('NEXT_PUBLIC_TOKEN', example)).toBe(false);
  });

  it('is false for a key the example never declares', () => {
    expect(isSecretKey('UNDECLARED', example)).toBe(false);
  });
});

describe('secretKeys', () => {
  it('lists exactly the empty, non-public keys in example order', () => {
    expect(secretKeys(example)).toEqual(['API_SECRET']);
  });
});
