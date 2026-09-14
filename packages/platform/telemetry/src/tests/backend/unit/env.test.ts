import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The off switch as an operator actually sets it: a string in the environment.
 *
 * `env.ts` resolves its profile at module load, so an override is exercised by
 * stubbing the variable and re-importing — the same thing a container does at
 * boot. `resetModules` is what makes the re-import re-resolve rather than hand
 * back the cached first evaluation.
 *
 * The value under test is a boolean arriving as text, which is the case
 * `jsonEnv` exists for. `z.coerce.boolean()` would make `'false'` true, so an
 * operator turning telemetry off would have turned it on — the one failure this
 * key cannot be allowed to have.
 */
async function telemetryEnabled() {
  vi.resetModules();
  const { env } = await import('../../../env');
  return env.OTEL_TELEMETRY_ENABLED;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('OTEL_TELEMETRY_ENABLED', () => {
  it('is on when nothing sets it', async () => {
    // The authored default. A clean checkout exports to the local collector with
    // no `.env` rows, which is why the switch defaults on rather than off.
    expect(await telemetryEnabled()).toBe(true);
  });

  it('is off when the environment says the string "false"', async () => {
    vi.stubEnv('OTEL_TELEMETRY_ENABLED', 'false');

    expect(await telemetryEnabled()).toBe(false);
  });

  it('is on when the environment says the string "true"', async () => {
    vi.stubEnv('OTEL_TELEMETRY_ENABLED', 'true');

    expect(await telemetryEnabled()).toBe(true);
  });

  it('refuses a value that is neither, rather than guessing at it', async () => {
    // A truthiness check would read `yes` as on and `off` as on too. Parsing
    // means an operator who mistypes the switch is told, at boot.
    vi.stubEnv('OTEL_TELEMETRY_ENABLED', 'yes');

    await expect(telemetryEnabled()).rejects.toThrow(/OTEL_TELEMETRY_ENABLED/);
  });

  it('falls back to the authored value when the variable is blank', async () => {
    // `emptyStringAsUndefined` — an exported-but-empty variable is "unset".
    vi.stubEnv('OTEL_TELEMETRY_ENABLED', '');

    expect(await telemetryEnabled()).toBe(true);
  });
});
