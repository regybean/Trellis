/**
 * The undeclared-import rule, asserted as what it is: a specifier reader, a
 * manifest reader, and a comparison between them.
 *
 * The cases worth spelling out are the ones the rule is *deliberately* quiet
 * about — a devDependency satisfying a runtime import, a workspace edge left to
 * `turbo boundaries` — because a later reader looking at a passing check has no
 * other way to tell silence from a gap.
 */
import { describe, expect, it } from 'vitest';

import {
  checkImports,
  declaredPackages,
  importedPackages,
  isSource,
  specifierPackage,
  suppressions,
} from '../../../imports';
import { fixtureIo } from '../package-io-fixture';

describe('the package a specifier names', () => {
  it('reads a bare specifier as itself', () => {
    expect(specifierPackage('zod')).toBe('zod');
  });

  it('reads a subpath as the package it enters — the zod/v4 case', () => {
    expect(specifierPackage('zod/v4')).toBe('zod');
    expect(specifierPackage('next/navigation')).toBe('next');
  });

  it('keeps both segments of a scoped package, and no more', () => {
    expect(specifierPackage('@acme/db')).toBe('@acme/db');
    expect(specifierPackage('@testing-library/react/pure')).toBe(
      '@testing-library/react',
    );
  });

  it('reads a scope with no package after it as naming nothing', () => {
    expect(specifierPackage('@acme')).toBeUndefined();
  });

  it.each(['./sibling', '../parent', '/absolute', '~/alias', '#internal', ''])(
    'reads %s as naming no package',
    (specifier) => {
      expect(specifierPackage(specifier)).toBeUndefined();
    },
  );

  it.each(['node:fs', 'fs', 'node:path', 'crypto'])(
    'reads the builtin %s as naming no package',
    (specifier) => {
      expect(specifierPackage(specifier)).toBeUndefined();
    },
  );
});

describe('the imports a source file makes', () => {
  it('finds a static import', () => {
    expect(importedPackages(`import { z } from 'zod';`)).toEqual(['zod']);
  });

  it('finds a type-only import — it needs the package on disk too', () => {
    expect(importedPackages(`import type { Stripe } from 'stripe';`)).toEqual([
      'stripe',
    ]);
  });

  it('finds a re-export', () => {
    expect(
      importedPackages(`export { render } from '@testing-library/react';`),
    ).toEqual(['@testing-library/react']);
  });

  it('finds a dynamic import', () => {
    expect(importedPackages(`const mod = await import('ioredis');`)).toEqual([
      'ioredis',
    ]);
  });

  it('finds a bare side-effect import', () => {
    expect(importedPackages(`import 'server-only';`)).toEqual(['server-only']);
  });

  it('reports a package once however many times it is imported', () => {
    expect(
      importedPackages(
        `import { z } from 'zod';\nimport { ZodError } from 'zod/v4';`,
      ),
    ).toEqual(['zod']);
  });

  it('finds nothing in a file that imports nothing external', () => {
    expect(
      importedPackages(
        `import { readEnv } from './read-env';\nimport 'node:fs';`,
      ),
    ).toEqual([]);
  });
});

describe('what a manifest declares', () => {
  it('counts every dependency field, not just `dependencies`', () => {
    const declared = declaredPackages({
      dependencies: { zod: 'catalog:' },
      devDependencies: { vitest: 'catalog:' },
      peerDependencies: { next: 'catalog:' },
      optionalDependencies: { sharp: '^0.35.4' },
    });

    expect([...declared].sort()).toEqual(['next', 'sharp', 'vitest', 'zod']);
  });

  it('ignores a dependency field that is not an object', () => {
    expect(declaredPackages({ dependencies: 'zod' }).size).toBe(0);
  });
});

describe('which files are read', () => {
  it.each([
    'src/env.ts',
    'src/app.tsx',
    'vitest.config.mts',
    'scripts/seed.js',
  ])('reads %s', (rel) => {
    expect(isSource(rel)).toBe(true);
  });

  it.each(['package.json', 'README.md', 'src/', 'src/styles.css'])(
    'skips %s',
    (rel) => {
      expect(isSource(rel)).toBe(false);
    },
  );
});

describe('suppressions', () => {
  it('reads an import -> reason map off the acme block', () => {
    const { reasons, errors } = suppressions({
      acme: { undeclaredImports: { next: 'resolved from the host app' } },
    });

    expect(errors).toEqual([]);
    expect(reasons.get('next')).toBe('resolved from the host app');
  });

  it('rejects a reason that is missing or blank — the reason is the point', () => {
    const { reasons, errors } = suppressions({
      acme: { undeclaredImports: { next: '   ' } },
    });

    expect(reasons.size).toBe(0);
    expect(errors[0]).toContain('needs a written reason');
  });

  it('rejects a map that is not an object', () => {
    expect(
      suppressions({ acme: { undeclaredImports: ['next'] } }).errors[0],
    ).toContain('must be an object of import -> reason');
  });

  it('finds none when the package declares none', () => {
    expect(
      suppressions({ acme: { testClass: 'backend-library' } }).errors,
    ).toEqual([]);
  });
});

const io = (manifest: Record<string, unknown>, files: Record<string, string>) =>
  fixtureIo({ 'packages/platform/db': { manifest, files } });

describe('the check over a workspace', () => {
  it('fails an import the package declares nowhere, naming package, import and file', () => {
    const { errors } = checkImports(
      io({ name: '@acme/db' }, { 'src/env.ts': `import { z } from 'zod/v4';` }),
    );

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('@acme/db');
    expect(errors[0]).toContain('`zod`');
    expect(errors[0]).toContain('src/env.ts');
  });

  it('passes when the package declares what it imports', () => {
    const { errors } = checkImports(
      io(
        { name: '@acme/db', dependencies: { zod: 'catalog:' } },
        { 'src/env.ts': `import { z } from 'zod/v4';` },
      ),
    );

    expect(errors).toEqual([]);
  });

  it('lets a devDependency satisfy a runtime import — placement is a separate question', () => {
    const { errors } = checkImports(
      io(
        { name: '@acme/db', devDependencies: { zod: 'catalog:' } },
        { 'src/env.ts': `import { z } from 'zod';` },
      ),
    );

    expect(errors).toEqual([]);
  });

  it('leaves an undeclared workspace edge to turbo boundaries', () => {
    const { errors } = checkImports(
      fixtureIo({
        'packages/platform/db': {
          manifest: { name: '@acme/db' },
          files: { 'src/index.ts': `import { env } from '@acme/env';` },
        },
        'packages/platform/env': { manifest: { name: '@acme/env' } },
      }),
    );

    expect(errors).toEqual([]);
  });

  it('reports one finding per package, not one per importing file', () => {
    const { errors } = checkImports(
      io(
        { name: '@acme/db' },
        {
          'src/env.ts': `import { z } from 'zod';`,
          'src/schema.ts': `import { z } from 'zod';`,
        },
      ),
    );

    expect(errors).toHaveLength(1);
  });

  it('accepts a suppressed import', () => {
    const { errors } = checkImports(
      io(
        {
          name: '@acme/db',
          acme: { undeclaredImports: { zod: 'provided by the host' } },
        },
        { 'src/env.ts': `import { z } from 'zod';` },
      ),
    );

    expect(errors).toEqual([]);
  });

  it('fails a suppression the package no longer needs, so they cannot rot', () => {
    const { errors } = checkImports(
      io(
        {
          name: '@acme/db',
          acme: { undeclaredImports: { zod: 'provided by the host' } },
        },
        { 'src/env.ts': `export const schema = {};` },
      ),
    );

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('no longer makes');
  });

  it('walks the workspace once', () => {
    const reader = io({ name: '@acme/db' }, { 'src/env.ts': '' });
    checkImports(reader);

    expect(reader.walks).toBe(1);
  });
});
