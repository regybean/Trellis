import { afterEach, describe, expect, it, vi } from 'vitest';

import { readEnv } from '../../read-env';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('readEnv', () => {
  it('reads the variable', () => {
    vi.stubEnv('ACME_READ_ENV_PROBE', 'set');

    expect(readEnv('ACME_READ_ENV_PROBE')).toBe('set');
  });

  it('is undefined when the variable is unset, so the profile value applies', () => {
    expect(readEnv('ACME_READ_ENV_ABSENT')).toBeUndefined();
  });

  it('is undefined where there is no process at all', () => {
    // The client bundle. Vite inlines only `NEXT_PUBLIC_*`, `APP_ENV` and
    // `NODE_ENV`, so any other `process.env.X` survives as a bare `process`
    // reference the browser cannot resolve — a throw while the env module is
    // still evaluating, which kills hydration. `typeof` is what makes this a
    // read and not a crash; the browser then resolves every key from its
    // authored profile, which is what config-as-code did before overrides.
    const realProcess = globalThis.process;
    Reflect.deleteProperty(globalThis, 'process');
    // Read and restore before asserting: vitest's own matchers run on `process`,
    // so the browser is modelled for exactly one call. `finally` is what keeps
    // that window closed even if the read throws — a worker left with no
    // `process` would take every later test in the file down with it.
    let value: string | undefined;
    try {
      value = readEnv('ACME_READ_ENV_PROBE');
    } finally {
      globalThis.process = realProcess;
    }

    expect(value).toBeUndefined();
  });
});
