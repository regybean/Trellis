import { describe, expect, it } from 'vitest';

import {
  collectViolations,
  formatReport,
  repoRoot,
  resolveRoot,
} from '../../../cli';

describe('resolveRoot', () => {
  it('takes the first non-flag argument as the root, resolved absolutely', () => {
    expect(resolveRoot(['fixtures/repo'], '/tmp/checkout')).toBe(
      '/tmp/checkout/fixtures/repo',
    );
  });

  it('reads past a flag, so a checker keeps its own flags', () => {
    expect(resolveRoot(['--todos', 'fixtures/repo'], '/tmp/checkout')).toBe(
      '/tmp/checkout/fixtures/repo',
    );
  });

  it('falls back to the repo git root rather than its own location', () => {
    expect(resolveRoot([])).toBe(repoRoot());
    expect(resolveRoot(['--todos'])).toBe(repoRoot());
  });
});

describe('formatReport', () => {
  const report = (
    fill: (violations: ReturnType<typeof collectViolations>) => void,
  ) => {
    const violations = collectViolations();
    fill(violations);
    return formatReport({
      name: 'check-fixture',
      violations,
      summary: 'check-fixture: 3 packages, all clean.',
      help: 'The rule is in docs/agents/domain.md.',
    });
  };

  it('exits zero and prints the summary when nothing is wrong', () => {
    const { code, stdout, stderr } = report(() => undefined);

    expect(code).toBe(0);
    expect(stdout).toBe('check-fixture: 3 packages, all clean.\n');
    expect(stderr).toBe('');
  });

  it('exits non-zero and names every error', () => {
    const { code, stdout, stderr } = report((violations) => {
      violations.error('@acme/ui: export key `./styles` is not registered');
      violations.error('@acme/db: test outside the layout: src/db.test.ts');
    });

    expect(code).toBe(1);
    expect(stdout).toBe('');
    expect(stderr).toContain('check-fixture found 2 problems');
    expect(stderr).toContain(
      '@acme/ui: export key `./styles` is not registered',
    );
    expect(stderr).toContain(
      '@acme/db: test outside the layout: src/db.test.ts',
    );
    expect(stderr).toContain('The rule is in docs/agents/domain.md.');
  });

  it('counts one problem as a problem', () => {
    const { stderr } = report((violations) => {
      violations.error('@acme/ui: one thing');
    });

    expect(stderr).toContain('check-fixture found 1 problem:');
  });

  it('reports warnings without failing the run', () => {
    const { code, stdout, stderr } = report((violations) => {
      violations.warn('0002 is missing from the sequence');
    });

    expect(code).toBe(0);
    expect(stderr).toContain('warn: 0002 is missing from the sequence');
    expect(stdout).toBe('check-fixture: 3 packages, all clean.\n');
  });

  it('reports warnings alongside errors', () => {
    const { code, stderr } = report((violations) => {
      violations.warn('0002 is missing from the sequence');
      violations.error('link to `CONTEXT.md` resolves to no file');
    });

    expect(code).toBe(1);
    expect(stderr).toContain('warn: 0002 is missing from the sequence');
    expect(stderr).toContain('resolves to no file');
  });
});
