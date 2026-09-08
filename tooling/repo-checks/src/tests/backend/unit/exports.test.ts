/**
 * The `exports` convention, asserted as what it is: a rule over a name and a
 * map. It had no tests until it could be called this way.
 */
import { describe, expect, it } from 'vitest';

import { checkExports, isGoverned, validateExports } from '../../../exports';
import { fixtureIo } from '../package-io-fixture';

const jit = (name: string) => ({
  types: `./dist/${name}.d.ts`,
  default: `./src/${name}.ts`,
});

describe('the export vocabulary', () => {
  it('accepts a conforming map', () => {
    expect(
      validateExports('@acme/chat', { '.': jit('index'), './env': jit('env') }),
    ).toEqual([]);
  });

  it('rejects a key outside the vocabulary, naming the key', () => {
    const [error, ...rest] = validateExports('@acme/ui', {
      './styles': jit('styles'),
    });

    expect(rest).toEqual([]);
    expect(error).toContain('@acme/ui');
    expect(error).toContain('./styles');
    expect(error).toContain('not in the allowed vocabulary');
  });

  it('says where a deliberate new role is registered', () => {
    expect(
      validateExports('@acme/ui', { './styles': jit('styles') })[0],
    ).toContain('tooling/repo-checks/src/exports.ts');
  });

  it('reports only the key when it is unregistered, not its shape as well', () => {
    // The old checker `continue`d here too: an unknown key's entry shape is
    // noise until the key itself is a decision.
    expect(
      validateExports('@acme/ui', { './styles': 'anything' }),
    ).toHaveLength(1);
  });
});

describe('the entry shape', () => {
  it('rejects a string entry — every entry is { types, default }', () => {
    const [error] = validateExports('@acme/db', { '.': './src/index.ts' });

    expect(error).toContain('must be a { types, default } object');
  });

  it('rejects an array entry', () => {
    expect(validateExports('@acme/db', { '.': [jit('index')] })[0]).toContain(
      'must be a { types, default } object',
    );
  });

  it('rejects an extra key beside types and default', () => {
    const errors = validateExports('@acme/db', {
      '.': { ...jit('index'), import: './src/index.ts' },
    });

    expect(errors[0]).toContain('unexpected keys: import');
  });

  it('rejects types pointing at source — that typechecks against untyped TS', () => {
    const errors = validateExports('@acme/db', {
      '.': { types: './src/index.ts', default: './src/index.ts' },
    });

    expect(errors[0]).toContain('.types must match ./dist/<name>.d.ts');
    expect(errors[0]).toContain('./src/index.ts');
  });

  it('rejects default pointing at build output — that ships stale dist', () => {
    const errors = validateExports('@acme/db', {
      '.': { types: './dist/index.d.ts', default: './dist/index.js' },
    });

    expect(errors[0]).toContain('.default must match ./src/<name>.ts');
  });

  it('reports a missing half of the pair', () => {
    const errors = validateExports('@acme/db', {
      '.': { types: './dist/index.d.ts' },
    });

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('.default must match');
  });

  it('reports every violating entry, not just the first', () => {
    const errors = validateExports('@acme/db', {
      '.': './src/index.ts',
      './server': './src/server.ts',
    });

    expect(errors).toHaveLength(2);
  });
});

describe('what the convention governs', () => {
  it('treats an absent map as nothing to police', () => {
    expect(validateExports('@acme/nextjs', undefined)).toEqual([]);
  });

  it('rejects a map that is not an object at all', () => {
    expect(validateExports('@acme/db', ['./src/index.ts'])[0]).toContain(
      '"exports" must be an object map',
    );
  });

  it('governs the runtime layers only', () => {
    expect(isGoverned('packages/features/chat')).toBe(true);
    expect(isGoverned('packages/platform/db')).toBe(true);
    expect(isGoverned('tooling/repo-checks')).toBe(false);
    expect(isGoverned('apps/nextjs')).toBe(false);
  });
});

describe('the whole check', () => {
  it('collects every governed package, leaving tooling and apps alone', () => {
    const io = fixtureIo({
      'packages/features/chat': {
        manifest: { name: '@acme/chat', exports: { '.': jit('index') } },
      },
      'packages/platform/db': {
        manifest: { name: '@acme/db', exports: { './styles': jit('styles') } },
      },
      'tooling/eslint': {
        manifest: {
          name: '@acme/eslint-config',
          exports: { './base': './base.ts' },
        },
      },
      'apps/nextjs': { manifest: { name: '@acme/nextjs' } },
    });

    const { errors, warnings } = checkExports(io);

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('@acme/db');
    expect(warnings).toEqual([]);
  });

  it('walks the workspace once', () => {
    const io = fixtureIo({
      'packages/features/chat': {
        manifest: { name: '@acme/chat', exports: { '.': jit('index') } },
      },
    });

    checkExports(io);

    expect(io.walks).toBe(1);
  });
});
