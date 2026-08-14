import { describe, expect, it } from 'vitest';

import {
  notificationSchema,
  publishInputSchema,
} from '../../../api/schemas/notification-schema';
import { decodeNotification } from '../../../api/services/notification-stream';

// Pure, no I/O, no mocks — the envelope round-trip and the codec's decode of a
// folded Redis field record. `publish` writes the envelope as a single `payload`
// JSON field; `decodeNotification` is its inverse (the primitive folds the raw
// field array to the record this consumes).
describe('notification envelope schema', () => {
  const envelope = {
    id: 'abc-123',
    kind: 'ingest.job-complete',
    level: 'success' as const,
    message: '4 documents indexed',
    createdAt: '2026-07-31T12:00:00.000Z',
    data: { jobId: 'job-1', total: 4 },
  };

  it('round-trips through structuredClone (the wire form publish writes)', () => {
    const decoded = notificationSchema.parse(structuredClone(envelope));
    expect(decoded).toEqual(envelope);
  });

  it('accepts an envelope with no data (opaque escape hatch is optional)', () => {
    const noData = {
      id: envelope.id,
      kind: envelope.kind,
      level: envelope.level,
      message: envelope.message,
      createdAt: envelope.createdAt,
    };
    expect(notificationSchema.parse(noData)).toEqual(noData);
  });

  it('rejects an unknown level (the enum is closed even though kind is open)', () => {
    expect(() =>
      notificationSchema.parse({ ...envelope, level: 'warning' }),
    ).toThrow();
  });

  it('treats kind as an open string — any feature key validates', () => {
    expect(
      notificationSchema.parse({ ...envelope, kind: 'some.future.feature' })
        .kind,
    ).toBe('some.future.feature');
  });

  it('publishInputSchema omits the server-minted id and createdAt', () => {
    const keys = Object.keys(publishInputSchema.shape).toSorted((a, b) =>
      a.localeCompare(b),
    );
    expect(keys).toEqual(['data', 'kind', 'level', 'message']);
  });

  it('decodeNotification decodes the single payload field back to the envelope', () => {
    const entry = decodeNotification({ payload: JSON.stringify(envelope) });
    expect(entry).toEqual(envelope);
  });

  it('decodeNotification throws when the payload field is absent (producer bug)', () => {
    expect(() => decodeNotification({ nope: 'x' })).toThrow(/payload/);
  });
});
