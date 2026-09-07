/**
 * The file format. One parser, one serializer, and they are inverses — which is
 * the fix for pull and push having disagreed about escaping.
 */
import { describe, expect, it } from 'vitest';

import { parseEnvFile, serializeEnv } from '../../../dotenv';

describe('parseEnvFile', () => {
  it('reads assignments and skips comments, blanks and prose', () => {
    expect(
      parseEnvFile(
        [
          '# a comment',
          '',
          'PUBLIC_URL=http://localhost:3000',
          'not an assignment',
          'DB_PORT=5432',
        ].join('\n'),
      ),
    ).toEqual({ PUBLIC_URL: 'http://localhost:3000', DB_PORT: '5432' });
  });

  it('distinguishes a declared-empty key from an absent one', () => {
    const env = parseEnvFile('API_SECRET=\n');
    expect(env.API_SECRET).toBe('');
    expect('API_SECRET' in env).toBe(true);
    expect('NOT_THERE' in env).toBe(false);
  });

  it('unescapes a quoted value', () => {
    expect(parseEnvFile('K="line one\\nline two"\n').K).toBe(
      'line one\nline two',
    );
    expect(parseEnvFile('K="say \\"hi\\""\n').K).toBe('say "hi"');
    expect(parseEnvFile('K="back\\\\slash"\n').K).toBe('back\\slash');
  });

  it('leaves an escape it does not emit alone', () => {
    expect(parseEnvFile('K="a\\tb"\n').K).toBe('a\\tb');
  });

  it('takes the last value when a key repeats, as dotenv readers do', () => {
    expect(parseEnvFile('K=first\nK=second\n').K).toBe('second');
  });
});

describe('serializeEnv', () => {
  it('writes safe values bare and quotes the rest', () => {
    expect(
      serializeEnv({ URL: 'http://localhost:3000', PHRASE: 'two words' }),
    ).toBe('URL=http://localhost:3000\nPHRASE="two words"\n');
  });

  it('writes an empty value as an empty assignment', () => {
    expect(serializeEnv({ API_SECRET: '' })).toBe('API_SECRET=\n');
  });

  it('preserves record order', () => {
    expect(serializeEnv({ B: '2', A: '1' })).toBe('B=2\nA=1\n');
  });

  it('is empty for an empty record', () => {
    expect(serializeEnv({})).toBe('');
  });
});

describe('the two together', () => {
  it.each([
    ['a newline', 'line one\nline two'],
    ['a double quote', 'say "hi"'],
    ['a backslash', 'C:\\Users\\dev'],
    ['a backslash before an n', 'literal \\n here'],
    ['a space', 'two words'],
    ['nothing at all', ''],
    ['an equals sign', 'key=value'],
  ])('round-trips a value containing %s', (_, value) => {
    expect(parseEnvFile(serializeEnv({ K: value })).K).toBe(value);
  });
});
