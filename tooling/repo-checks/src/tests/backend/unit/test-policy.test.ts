/**
 * The test policy, rule by rule.
 *
 * Each of these used to be a whole workspace in a temp directory, because the
 * rule and the filesystem walk were the same code. They are statements about a
 * manifest and a list of paths, so that is what they are asserted against here;
 * the CLI keeps a thin subprocess layer of its own.
 *
 * The **passing** cases carry as much weight as the failures. `passWithNoTests`
 * stays on, so a file a rule waves through and the projects don't collect is a
 * test that silently never runs.
 */
import { describe, expect, it } from 'vitest';

import {
  checkTestPolicy,
  isCollectible,
  isRuntimeLayer,
  testClassContradictions,
  validateFrontendSeamMocks,
  validateTestLayout,
  validateTestManifest,
  validateTestTaxonomy,
  validateUnitPurity,
} from '../../../test-policy';
import { fixtureIo } from '../package-io-fixture';

const SCRIPTS = {
  'full-stack': {
    test: 'true',
    'test:backend': 'true',
    'test:backend:watch': 'true',
    'test:frontend': 'true',
    'test:frontend:watch': 'true',
    'test:watch': 'true',
  },
  'backend-library': {
    test: 'true',
    'test:backend': 'true',
    'test:backend:watch': 'true',
  },
  'frontend-library': {
    test: 'true',
    'test:frontend': 'true',
    'test:frontend:watch': 'true',
  },
};

/** The script names a conforming package of `testClass` exposes. */
const scriptsFor = (testClass: keyof typeof SCRIPTS) =>
  Object.keys(SCRIPTS[testClass]);

describe('the acme block', () => {
  it('accepts a conforming library package', () => {
    const verdict = validateTestManifest(
      '@acme/chat',
      { testClass: 'full-stack' },
      scriptsFor('full-stack'),
    );

    expect(verdict.errors).toEqual([]);
    expect(verdict.warnings).toEqual([]);
    expect(verdict.policy).toEqual({
      testClass: 'full-stack',
      trackedGap: false,
    });
    expect(verdict.gap).toBeUndefined();
  });

  it('fails a package that declares no testClass, listing the classes', () => {
    const { errors, policy } = validateTestManifest(
      '@acme/chat',
      undefined,
      [],
    );

    expect(errors[0]).toContain('missing "acme.testClass"');
    expect(errors[0]).toContain('backend-library');
    // Nothing further is checkable without a class.
    expect(policy).toBeUndefined();
  });

  it('fails an unknown testClass and checks nothing further', () => {
    const { errors, policy } = validateTestManifest(
      '@acme/chat',
      { testClass: 'e2e' },
      [],
    );

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('invalid "acme.testClass" `e2e`');
    expect(policy).toBeUndefined();
  });

  it('fails a library package missing the scripts its class owes', () => {
    const { errors } = validateTestManifest(
      '@acme/db',
      { testClass: 'backend-library' },
      ['test'],
    );

    expect(errors[0]).toContain('missing scripts: test:backend');
    expect(errors[0]).toContain('test:backend:watch');
  });

  it('asks app and none for a reason, and nothing else', () => {
    const app = validateTestManifest('@acme/nextjs', { testClass: 'app' }, []);
    const none = validateTestManifest(
      '@acme/models',
      { testClass: 'none', reason: 'pure type re-exports' },
      [],
    );

    expect(app.errors[0]).toContain('"acme.reason" is required');
    expect(none.errors).toEqual([]);
  });
});

describe('a tracked gap', () => {
  const gap = { testClass: 'backend-library', testStatus: 'todo' };

  it('is allowed with a reason, and reported as a gap', () => {
    const verdict = validateTestManifest(
      '@acme/test-utils',
      { ...gap, reason: 'tests land with the next slice' },
      [],
    );

    expect(verdict.errors).toEqual([]);
    expect(verdict.gap).toEqual({
      name: '@acme/test-utils',
      testClass: 'backend-library',
      reason: 'tests land with the next slice',
    });
    expect(verdict.policy?.trackedGap).toBe(true);
  });

  it('requires a reason', () => {
    expect(validateTestManifest('@acme/db', gap, []).errors[0]).toContain(
      '"acme.reason" is required',
    );
  });

  it('warns when the package already ships every script — a stale marker', () => {
    const verdict = validateTestManifest(
      '@acme/db',
      { ...gap, reason: 'no longer true' },
      scriptsFor('backend-library'),
    );

    expect(verdict.errors).toEqual([]);
    expect(verdict.warnings[0]).toContain('drop the todo');
  });

  it('is only valid on a library class', () => {
    const { errors } = validateTestManifest(
      '@acme/nextjs',
      { testClass: 'app', testStatus: 'todo', reason: 'later' },
      [],
    );

    expect(errors[0]).toContain('only valid on library classes');
  });

  it('rejects any other testStatus, string or not', () => {
    const wrong = validateTestManifest(
      '@acme/db',
      { testClass: 'backend-library', testStatus: 'wip' },
      scriptsFor('backend-library'),
    );
    const notAString = validateTestManifest(
      '@acme/db',
      { testClass: 'backend-library', testStatus: 5 },
      scriptsFor('backend-library'),
    );

    expect(wrong.errors[0]).toContain('invalid "acme.testStatus" `wip`');
    expect(notAString.errors[0]).toContain('invalid "acme.testStatus" `5`');
  });
});

describe('every test sits under src/tests/<layer>/', () => {
  const layout = (files: string[]) =>
    validateTestLayout('@acme/alpha', 'full-stack', files);

  it('passes the conforming layout', () => {
    expect(
      layout([
        'src/tests/backend/unit/policy.test.ts',
        'src/tests/frontend/integration/hooks/use-alpha.test.tsx',
      ]),
    ).toEqual([]);
  });

  it('fails a test outside src/tests/, naming the path', () => {
    const [error] = layout(['src/api/routers/alpha.test.ts']);

    expect(error).toContain('@acme/alpha');
    expect(error).toContain('src/api/routers/alpha.test.ts');
    expect(error).toContain('outside the layout');
  });

  it('fails a test under src/tests/ with the layer segment missing', () => {
    expect(layout(['src/tests/unit/policy.test.ts'])[0]).toContain(
      'src/tests/unit/policy.test.ts',
    );
  });

  it('fails a third layer name, since only two are collected', () => {
    const errors = layout(['src/tests/e2e/unit/smoke.test.ts']);

    expect(errors.join('\n')).toContain('src/tests/e2e');
  });

  it('fails a .tsx test in the backend layer — the backend glob is .test.ts', () => {
    const [error] = layout(['src/tests/backend/unit/policy.test.tsx']);

    expect(error).toContain('never collects');
    expect(error).toContain('src/tests/backend/**/*.test.ts');
  });

  it('fails a *.spec.ts, which neither project collects', () => {
    expect(layout(['src/tests/backend/unit/policy.spec.ts'])[0]).toContain(
      'policy.spec.ts',
    );
  });

  it('leaves a non-test file alone wherever it sits', () => {
    expect(
      layout(['src/tests/backend/global-setup.ts', 'src/api/routers/alpha.ts']),
    ).toEqual([]);
  });
});

describe('the layers a package may carry follow its testClass', () => {
  it('fails a backend-library carrying src/tests/frontend/, even empty', () => {
    const [error] = validateTestLayout('@acme/beta', 'backend-library', [
      'src/tests/backend/unit/policy.test.ts',
      'src/tests/frontend/',
    ]);

    expect(error).toContain('@acme/beta');
    expect(error).toContain('src/tests/frontend/');
    expect(error).toContain('backend-library');
  });

  it('fails a frontend-library carrying src/tests/backend/', () => {
    const [error] = validateTestLayout('@acme/beta', 'frontend-library', [
      'src/tests/frontend/unit/format.test.tsx',
      'src/tests/backend/',
    ]);

    expect(error).toContain('src/tests/backend/');
  });

  it('passes a single-sided package that keeps the layer segment', () => {
    expect(
      validateTestLayout('@acme/beta', 'backend-library', [
        'src/tests/backend/unit/policy.test.ts',
      ]),
    ).toEqual([]);
  });

  it('names an unknown layer directory as unknown', () => {
    const [error] = validateTestLayout('@acme/beta', 'app', ['src/tests/e2e/']);

    expect(error).toContain('unknown test layer src/tests/e2e/');
  });

  it('constrains no side on app and none, which declare none', () => {
    expect(
      validateTestLayout('@acme/nextjs', 'app', [
        'src/tests/backend/unit/a.test.ts',
        'src/tests/frontend/unit/b.test.tsx',
      ]),
    ).toEqual([]);
  });
});

describe('what the vitest projects collect', () => {
  it('takes .test.ts on the backend and both extensions on the frontend', () => {
    expect(isCollectible('src/tests/backend/unit/a.test.ts')).toBe(true);
    expect(isCollectible('src/tests/backend/unit/a.test.tsx')).toBe(false);
    expect(isCollectible('src/tests/frontend/unit/a.test.ts')).toBe(true);
    expect(isCollectible('src/tests/frontend/unit/a.test.tsx')).toBe(true);
  });

  it('collects nothing outside the two layer directories', () => {
    expect(isCollectible('src/tests/unit/a.test.ts')).toBe(false);
    expect(isCollectible('src/a.test.ts')).toBe(false);
  });
});

describe('the taxonomy', () => {
  it('accepts the filed seams', () => {
    expect(
      validateTestTaxonomy('@acme/chat', [
        'src/tests/backend/unit/reducer.test.ts',
        'src/tests/backend/integration/api/router.test.ts',
        'src/tests/backend/integration/service/ingest.test.ts',
        'src/tests/frontend/unit/format.test.tsx',
        'src/tests/frontend/integration/hooks/use-chat.test.tsx',
        'src/tests/frontend/integration/components/panel.test.tsx',
      ]),
    ).toEqual([]);
  });

  it('rejects a backend test in an old flat folder', () => {
    const [error] = validateTestTaxonomy('@acme/chat', [
      'src/tests/backend/api/router.test.ts',
    ]);

    expect(error).toContain('backend test outside the taxonomy');
    expect(error).toContain('integration/api/');
  });

  it('rejects a frontend test outside its own three seams', () => {
    const [error] = validateTestTaxonomy('@acme/chat', [
      'src/tests/frontend/components/panel.test.tsx',
    ]);

    expect(error).toContain('frontend test outside the taxonomy');
    expect(error).toContain('integration/components/');
  });

  it('governs the runtime layers only', () => {
    expect(isRuntimeLayer('packages/features/chat')).toBe(true);
    expect(isRuntimeLayer('tooling/repo-checks')).toBe(false);
    expect(isRuntimeLayer('apps/nextjs')).toBe(false);
  });
});

describe('unit purity', () => {
  const purity = (text: string) =>
    validateUnitPurity('@acme/chat', [
      { rel: 'src/tests/backend/unit/reducer.test.ts', text },
    ]);

  it('passes a solitary test', () => {
    expect(purity("import { reduce } from '../../../reducer';")).toEqual([]);
  });

  it.each(['vi.mock(', 'vi.spyOn(', 'vi.fn('])(
    'rejects a unit test reaching for %s',
    (pattern) => {
      const [error] = purity(`${pattern}'../../../reducer');`);

      expect(error).toContain(pattern);
      expect(error).toContain('move to integration/');
      expect(error).toContain('src/tests/backend/unit/reducer.test.ts');
    },
  );

  it('reports one finding per file, not one per pattern', () => {
    expect(purity('vi.mock("x"); vi.fn(); vi.spyOn(a, "b");')).toHaveLength(1);
  });
});

describe('the frontend seam-mock ban', () => {
  const seams = (text: string) =>
    validateFrontendSeamMocks('packages/features/chat', [
      { rel: 'src/tests/frontend/integration/hooks/use-chat.test.tsx', text },
    ]);

  it('rejects mocking the tRPC client the feature owns', () => {
    const [error] = seams("vi.mock('../../../trpc/react');");

    expect(error).toContain('mocks the tRPC client you own');
    expect(error).toContain('ADR 0018');
  });

  it("rejects mocking the feature's own hook", () => {
    expect(seams("vi.mock('../../hooks/use-chat');")[0]).toContain(
      'the hook is the contract',
    );
  });

  it('rejects mocking react-toastify', () => {
    expect(seams("vi.mock('react-toastify');")[0]).toContain(
      '<ToastContainer />',
    );
  });

  it('leaves a framework external mockable', () => {
    expect(seams("vi.mock('next/navigation');")).toEqual([]);
  });
});

describe('the contradiction tripwire', () => {
  it('warns when a test-free package ships UI', () => {
    const [warning] = testClassContradictions('@acme/models', 'none', [
      'src/',
      'src/panel.tsx',
    ]);

    expect(warning).toContain('ships .tsx (UI)');
  });

  it('warns when a test-free package ships a router', () => {
    const [warning] = testClassContradictions('@acme/models', 'none', [
      'src/',
      'src/api/',
      'src/api/root.ts',
    ]);

    expect(warning).toContain('ships src/api (router)');
  });

  it('says nothing about a package that claims a class', () => {
    expect(
      testClassContradictions('@acme/chat', 'full-stack', [
        'src/panel.tsx',
        'src/api/',
      ]),
    ).toEqual([]);
  });
});

describe('the whole check', () => {
  const conforming = {
    'packages/features/alpha': {
      manifest: {
        name: '@acme/alpha',
        scripts: SCRIPTS['full-stack'],
        acme: { testClass: 'full-stack' },
      },
      files: {
        'src/tests/backend/unit/policy.test.ts': '',
        'src/tests/frontend/integration/hooks/use-alpha.test.tsx': '',
      },
    },
  };

  it('passes a conforming workspace', () => {
    const { violations, gaps } = checkTestPolicy(fixtureIo(conforming));

    expect(violations.errors).toEqual([]);
    expect(violations.warnings).toEqual([]);
    expect(gaps).toEqual([]);
  });

  it('walks the workspace once', () => {
    const io = fixtureIo(conforming);

    checkTestPolicy(io);

    expect(io.walks).toBe(1);
  });

  it('exempts a tracked gap from the layout rule and collects it', () => {
    const { violations, gaps } = checkTestPolicy(
      fixtureIo({
        'packages/platform/beta': {
          manifest: {
            name: '@acme/beta',
            acme: {
              testClass: 'backend-library',
              testStatus: 'todo',
              reason: 'tests land with the next slice',
            },
          },
          files: {
            'src/tests/unit/policy.test.ts': '',
            'src/tests/frontend/': '',
          },
        },
      }),
    );

    expect(violations.errors).toEqual([]);
    expect(gaps.map((gap) => gap.name)).toEqual(['@acme/beta']);
  });

  it('applies the taxonomy and mock rules to runtime packages only', () => {
    const files = {
      'src/tests/backend/api/router.test.ts': 'vi.mock("./x");',
    };
    const acme = { testClass: 'backend-library' };
    const scripts = SCRIPTS['backend-library'];

    const runtime = checkTestPolicy(
      fixtureIo({
        'packages/platform/beta': {
          manifest: { name: '@acme/beta', scripts, acme },
          files,
        },
      }),
    );
    const tooling = checkTestPolicy(
      fixtureIo({
        'tooling/beta': {
          manifest: { name: '@acme/beta-tooling', scripts, acme },
          files,
        },
      }),
    );

    expect(runtime.violations.errors).toHaveLength(1);
    expect(runtime.violations.errors[0]).toContain('outside the taxonomy');
    expect(tooling.violations.errors).toEqual([]);
  });
});
