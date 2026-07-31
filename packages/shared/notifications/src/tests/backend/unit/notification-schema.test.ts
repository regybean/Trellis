import { describe, expect, it } from 'vitest';

import {
  notificationSchema,
  publishInputSchema,
} from '../../../api/schemas/notification-schema';
import { parseEntry } from '../../../api/services/notification-parser';

// Pure, no I/O, no mocks — the envelope round-trip and the parser's decode of a
// flat Redis field array. `publish` writes the envelope as a single `payload`
// JSON field; `parseEntry` is its inverse.
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

  it('parseEntry decodes the single payload field back to the envelope', () => {
    const entry = parseEntry(['payload', JSON.stringify(envelope)]);
    expect(entry).toEqual(envelope);
  });

  it('parseEntry throws when the payload field is absent (producer bug)', () => {
    expect(() => parseEntry(['nope', 'x'])).toThrow(/payload/);
  });
});
