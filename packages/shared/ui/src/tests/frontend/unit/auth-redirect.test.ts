/**
 * The same-site rule for `?redirect=`.
 *
 * `apps/nextjs` shipped its sign-in page without this check (#238), so
 * `?redirect=https://evil.example` navigated the visitor off-site the moment
 * they authenticated. The rule now lives here, shared by both apps (#239) — and
 * a rule that is one `startsWith` away from an open redirect is worth pinning
 * case by case.
 */
import { describe, expect, it } from 'vitest';

import { authSearchSchema, toSameSitePath } from '../../../index';

describe('toSameSitePath', () => {
  it('keeps a same-site path, including its query and fragment', () => {
    expect(toSameSitePath('/admin')).toBe('/admin');
    expect(toSameSitePath('/chat-assistant?new=1#top')).toBe(
      '/chat-assistant?new=1#top',
    );
  });

  it.each([
    ['an absolute https URL', 'https://evil.example'],
    ['an absolute http URL', 'http://evil.example/steal'],
    // The one that reads as a path but is not: the browser resolves `//host`
    // against the current scheme and leaves the site.
    ['a protocol-relative URL', '//evil.example'],
    ['a scheme-relative URL with a path', '//evil.example/admin'],
    // eslint-disable-next-line sonarjs/code-eval -- a fixture string, never evaluated
    ['a javascript: URL', 'javascript:alert(1)'],
    ['a bare relative path', 'admin'],
    ['an empty string', ''],
  ])('sends %s home instead', (_label, value) => {
    expect(toSameSitePath(value)).toBe('/');
  });

  it('sends a missing or non-string parameter home', () => {
    // `useSearchParams().get()` returns null for an absent key; the array is
    // what a repeated `?redirect=` would produce on a router that collects them.
    const absent: unknown = undefined;

    expect(toSameSitePath(null)).toBe('/');
    expect(toSameSitePath(absent)).toBe('/');
    expect(toSameSitePath(['/admin'])).toBe('/');
  });
});

describe('authSearchSchema', () => {
  it('drops an off-site redirect rather than failing the parse', () => {
    // A transform, not a validation: a malformed `redirect` must not 400 the
    // sign-in form and leave the visitor with no way in.
    expect(authSearchSchema.parse({ redirect: '//evil.example' })).toEqual({
      redirect: undefined,
    });
    expect(authSearchSchema.parse({})).toEqual({ redirect: undefined });
  });

  it('passes a same-site path through', () => {
    expect(authSearchSchema.parse({ redirect: '/admin' })).toEqual({
      redirect: '/admin',
    });
  });
});
