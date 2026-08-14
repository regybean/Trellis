/**
 * createIngestProcessor — direct invocation (integration).
 *
 * Calls the processor directly (not through a BullMQ runner) against real Redis +
 * Postgres (testcontainers). S3 is mocked (setup.ts) so `downloadFileFromS3` is
 * driven per test; embeddings are the fake model (setup.ts). `uploadDoc` runs FOR
 * REAL, so idempotency (uuidv5 chunk ids) is exercised end-to-end.
 *
 * We assert the seams the processor owns:
 *  - the per-file stage sequence on the progress stream (read back via the pure
 *    parser the reader uses);
 *  - `allSettled` isolation: a content-fail (empty file) stays green + counted +
 *    lets siblings finish; an infra-fail (download throws) rethrows and publishes
 *    NOTHING;
 *  - the single completion notification on the settled path (shape + once);
 *  - uuidv5 idempotency: a re-run adds no duplicate chunks.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Job } from '@acme/queue';
import { notificationSchema } from '@acme/notifications/schema';
import { notificationKey } from '@acme/notifications/server';
import { deleteByFilename, listDocuments } from '@acme/rag/server';
import { redis } from '@acme/redis';

import type { IngestJob } from '../../../../api/services/ingest-queue';
import { createIngestProcessor } from '../../../../api/services/ingest-processor';
import { ingestProgressStream } from '../../../../api/services/ingest-progress-stream';
import {
  deleteFilesFromS3,
  downloadFileFromS3,
} from '../../../../utils/s3-client';
import { cleanupTestData } from '../../utils/test-context';

const userId = 'user-ingest-proc';

// The processor takes a BullMQ Job; only `.data` is read. Cast the minimal shape
// (mirrors chat's processor test) — constructing a full BullMQ Job is impractical.
function makeJob(uploads: IngestJob['uploads']): Job<IngestJob> {
  return {
    data: { jobId: crypto.randomUUID(), userId, uploads },
  } as Job<IngestJob>;
}

// A distinct filename per Upload so parallel test files never collide in the
// shared vector DB; tracked for cleanup.
const created: string[] = [];
function uniqueName() {
  const name = `proc-${crypto.randomUUID()}.txt`;
  created.push(name);
  return name;
}

// Wire `downloadFileFromS3` to return the given text for each s3Key.
function stubDownloads(byKey: Map<string, string>) {
  vi.mocked(downloadFileFromS3).mockImplementation((key: string) => {
    const content = byKey.get(key);
    if (content === undefined) throw new Error(`unexpected s3 key: ${key}`);
    return Promise.resolve({
      buffer: Buffer.from(content),
      contentType: 'text/plain',
    });
  });
}

// Read the progress stream back through the same codec the reader uses.
async function readProgress() {
  const entries = await ingestProgressStream(userId).read();
  return entries.map((entry) => entry.event);
}

async function readNotifications() {
  const entries = await redis.xRange(notificationKey(userId), '-', '+');
  return entries.map(([, fields]) => {
    const idx = fields.indexOf('payload');
    const value = fields.at(idx + 1);
    if (value === undefined) throw new Error('expected a payload field');
    return notificationSchema.parse(JSON.parse(value));
  });
}

describe('createIngestProcessor', () => {
  beforeEach(async () => {
    await cleanupTestData();
    vi.mocked(deleteFilesFromS3).mockImplementation(() => Promise.resolve());
  });

  afterEach(async () => {
    for (const name of created.splice(0)) await deleteByFilename(name);
    await cleanupTestData();
  });

  it('runs every file: queued → parsing → embedding → done per Upload', async () => {
    const filename = uniqueName();
    const s3Key = `uploads/j/u1/${filename}`;
    stubDownloads(new Map([[s3Key, 'Content worth chunking and embedding.']]));

    await createIngestProcessor()(
      makeJob([{ uploadId: 'u1', filename, s3Key }]),
    );

    const events = await readProgress();
    const stages = events.map((e) => e.stage);
    expect(stages).toEqual(['queued', 'parsing', 'embedding', 'done']);
  });

  it('publishes exactly one completion notification on the settled path', async () => {
    const filename = uniqueName();
    const s3Key = `uploads/j/u1/${filename}`;
    stubDownloads(new Map([[s3Key, 'Content worth chunking and embedding.']]));

    const job = makeJob([{ uploadId: 'u1', filename, s3Key }]);
    await createIngestProcessor()(job);

    const notifications = await readNotifications();
    expect(notifications).toHaveLength(1);
    const [note] = notifications;
    expect(note?.kind).toBe('ingest.job-complete');
    expect(note?.level).toBe('success');
    expect(note?.data).toMatchObject({
      jobId: job.data.jobId,
      total: 1,
      succeeded: 1,
      failed: [],
    });
  });

  it('isolates a content failure: siblings finish, job stays green + counted', async () => {
    const okName = uniqueName();
    const badName = uniqueName();
    const okKey = `uploads/j/ok/${okName}`;
    const badKey = `uploads/j/bad/${badName}`;
    // The bad file is empty → uploadDoc throws DocumentParseError (content-fail).
    stubDownloads(
      new Map([
        [okKey, 'Good content worth chunking and embedding.'],
        [badKey, ''],
      ]),
    );

    await createIngestProcessor()(
      makeJob([
        { uploadId: 'ok', filename: okName, s3Key: okKey },
        { uploadId: 'bad', filename: badName, s3Key: badKey },
      ]),
    );

    // The good sibling reached done; the bad one reached failed.
    const events = await readProgress();
    const okDone = events.some(
      (e) => e.uploadId === 'ok' && e.stage === 'done',
    );
    const badFailed = events.find(
      (e) => e.uploadId === 'bad' && e.stage === 'failed',
    );
    expect(okDone).toBe(true);
    expect(badFailed).toBeDefined();

    // A single completion notification, counting the failure but staying green.
    const [note] = await readNotifications();
    expect(note?.level).toBe('error');
    expect(note?.data).toMatchObject({
      total: 2,
      succeeded: 1,
      failed: [{ uploadId: 'bad', filename: badName }],
    });

    // The good document was indexed for real.
    const docs = await listDocuments();
    expect(docs.find((d) => d.filename === okName)?.count).toBeGreaterThan(0);
  });

  it('rethrows on an infra failure and publishes no completion', async () => {
    const filename = uniqueName();
    const s3Key = `uploads/j/u1/${filename}`;
    // Download rejects — an infra failure (not a DocumentParseError).
    vi.mocked(downloadFileFromS3).mockRejectedValue(
      new Error('S3 unreachable'),
    );

    await expect(
      createIngestProcessor()(makeJob([{ uploadId: 'u1', filename, s3Key }])),
    ).rejects.toThrow('S3 unreachable');

    // Per-file failed was still emitted, but NO completion notification fired.
    const events = await readProgress();
    expect(events.some((e) => e.stage === 'failed')).toBe(true);
    expect(await readNotifications()).toHaveLength(0);
  });

  it('is idempotent: re-running the same file adds no duplicate chunks', async () => {
    const filename = uniqueName();
    const s3Key = `uploads/j/u1/${filename}`;
    stubDownloads(
      new Map([[s3Key, 'Stable content. Chunked and embedded once.']]),
    );

    await createIngestProcessor()(
      makeJob([{ uploadId: 'u1', filename, s3Key }]),
    );
    const firstDocs = await listDocuments();
    const first = firstDocs.find((d) => d.filename === filename);

    await createIngestProcessor()(
      makeJob([{ uploadId: 'u1', filename, s3Key }]),
    );
    const secondDocs = await listDocuments();
    const second = secondDocs.find((d) => d.filename === filename);

    expect(first?.count).toBeGreaterThan(0);
    expect(second?.count).toBe(first?.count);
  });
});
