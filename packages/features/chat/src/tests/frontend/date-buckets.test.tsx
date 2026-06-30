import { describe, expect, it } from 'vitest';

import { bucketOf } from '../../lib/date-buckets';

// `now` is fixed mid-afternoon so "today" clearly starts at an earlier local
// midnight and the 7-day window is unambiguous.
const NOW = new Date('2026-06-30T15:00:00');

describe('bucketOf', () => {
  it('buckets activity since local midnight as today', () => {
    expect(bucketOf(new Date('2026-06-30T00:00:00'), NOW)).toBe('today');
    expect(bucketOf(new Date('2026-06-30T14:59:59'), NOW)).toBe('today');
  });

  it('buckets the prior 7 days as week', () => {
    expect(bucketOf(new Date('2026-06-29T23:59:59'), NOW)).toBe('week');
    expect(bucketOf(new Date('2026-06-24T15:00:01'), NOW)).toBe('week');
  });

  it('buckets anything older than 7 days as older', () => {
    expect(bucketOf(new Date('2026-06-23T14:59:59'), NOW)).toBe('older');
    expect(bucketOf(new Date('2025-01-01T00:00:00'), NOW)).toBe('older');
  });
});
