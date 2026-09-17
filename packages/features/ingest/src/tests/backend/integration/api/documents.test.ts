/**
 * Documents + Data Sources Router Tests
 *
 * Testing philosophy:
 * - Authorization is ROW OWNERSHIP, not a role. Every procedure is
 *   `protectedProcedure`, so `rejects unauthenticated` is the same one-line
 *   middleware fact this repo already proves once per package — it buys nothing
 *   here. What the router can get wrong is which rows it hands back, so the
 *   coverage is "is this row this user's?": A cannot list, delete into, or
 *   presign into B's Source, and B's Source is absent from A's list.
 * - Presign: the server-minted Job identity, the reshaped response, and the
 *   authoritative quota check.
 * - startIngestJob: validation (jobId-prefix guard), the real-queue enqueue
 *   read-back through `_ingestQueue`, and the TRPCError-on-enqueue-failure path.
 *
 * Data Sources are seeded through rag's own `createDataSource`, never a raw
 * insert: a fixture with more power than production can lie in both directions,
 * which for an authorization test is uniquely bad.
 *
 * `@acme/rag/server` is driven FOR REAL (never `vi.mock`'d — the processor + worker
 * e2e in this same non-isolated suite import it real, and a local mock would
 * corrupt the shared module registry). Only S3 is mocked (setup.ts). The queue is
 * REAL (BullMQ on the testcontainer Redis).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { env as ragEnv } from '@acme/rag/env';
import {
  createDataSource,
  deleteDataSource,
  ensureVectorIndex,
  uploadDoc,
} from '@acme/rag/server';

import type { TestContextOptions } from '../../utils/test-context';
import { appRouter } from '../../../../api/root';
import { readProgressSnapshot } from '../../../../api/services/ingest-progress-snapshot';
import { _ingestQueue } from '../../../../api/services/ingest-queue';
import { generatePresignedUploadUrl } from '../../../../utils/s3-client';
import { createTestContext } from '../../utils/test-context';

const userA: TestContextOptions = { userId: 'user_a_docs', role: 'user' };
const userB: TestContextOptions = { userId: 'user_b_docs', role: 'user' };

function createCaller(opts: TestContextOptions) {
  return appRouter.createCaller(createTestContext(opts));
}

// Sources created by a test, torn down through the production cascade so no
// case depends on another's leftovers.
const sources: { ownerId: string; id: string }[] = [];

async function seedSource(opts: TestContextOptions, name: string) {
  const id = crypto.randomUUID();
  const created = await createDataSource({ ownerId: opts.userId, id, name });
  sources.push({ ownerId: opts.userId, id });
  return created;
}

// A batch of n distinct filenames, for the cap boundary.
const batchOf = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    filename: `batch-${i}.txt`,
    contentType: 'text/plain',
  }));

function txtFile(name: string) {
  return new File(['Indexable content worth chunking.'], name, {
    type: 'text/plain',
  });
}

// Presign a one-file batch and reshape the response into the `startIngestJob`
// input (echoed server-minted ids + s3Key).
async function presignedBatch(opts: TestContextOptions, dataSourceId: string) {
  vi.mocked(generatePresignedUploadUrl).mockImplementation((key) =>
    Promise.resolve(`https://s3.test/${key}`),
  );
  const { jobId, uploads } = await createCaller(
    opts,
  ).documents.getPresignedUploadUrls({
    dataSourceId,
    files: [{ filename: 'a.pdf', contentType: 'application/pdf' }],
  });
  return {
    jobId,
    uploads: uploads.map((u) => ({
      uploadId: u.uploadId,
      filename: u.filename,
      s3Key: u.s3Key,
    })),
  };
}

describe('documentsRouter', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // No worker runs here, so jobs pile up; clear between tests to avoid jobId
    // dedup collisions on the enqueue read-back.
    await _ingestQueue.obliterate({ force: true });
    await ensureVectorIndex();
  });

  afterEach(async () => {
    for (const source of sources.splice(0)) await deleteDataSource(source);
  });

  describe('owner scoping (the authorization this router does)', () => {
    it("rejects listing another user's Data Source", async () => {
      const bSource = await seedSource(userB, "B's private notes");

      await expect(
        createCaller(userA).documents.list({ dataSourceId: bSource.id }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it("rejects deleting a Document in another user's Data Source", async () => {
      const bSource = await seedSource(userB, "B's deletable");
      const filename = `b-${crypto.randomUUID()}.txt`;
      await uploadDoc(txtFile(filename), {
        ownerId: userB.userId,
        dataSourceId: bSource.id,
      });

      await expect(
        createCaller(userA).documents.delete({
          dataSourceId: bSource.id,
          filename,
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });

      // The rejection is not merely a code: B's Document is still there.
      const bDocs = await createCaller(userB).documents.list({
        dataSourceId: bSource.id,
      });
      expect(bDocs.map((d) => d.filename)).toEqual([filename]);
    });

    it("rejects presigning into another user's Data Source", async () => {
      const bSource = await seedSource(userB, "B's upload target");

      await expect(
        createCaller(userA).documents.getPresignedUploadUrls({
          dataSourceId: bSource.id,
          files: [{ filename: 'a.pdf', contentType: 'application/pdf' }],
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it("rejects enqueueing into another user's Data Source", async () => {
      const aSource = await seedSource(userA, "A's own");
      const bSource = await seedSource(userB, "B's enqueue target");
      const { jobId, uploads } = await presignedBatch(userA, aSource.id);

      await expect(
        createCaller(userA).documents.startIngestJob({
          jobId,
          dataSourceId: bSource.id,
          uploads,
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });

      expect(await _ingestQueue.getJob(jobId)).toBeUndefined();
    });

    it("omits another user's Documents from the All documents roll-up", async () => {
      const aSource = await seedSource(userA, "A's roll-up");
      const bSource = await seedSource(userB, "B's roll-up");
      const aFile = `a-${crypto.randomUUID()}.txt`;
      const bFile = `b-${crypto.randomUUID()}.txt`;
      await uploadDoc(txtFile(aFile), {
        ownerId: userA.userId,
        dataSourceId: aSource.id,
      });
      await uploadDoc(txtFile(bFile), {
        ownerId: userB.userId,
        dataSourceId: bSource.id,
      });

      const rows = await createCaller(userA).documents.list({});

      expect(rows.map((r) => r.filename)).toEqual([aFile]);
      // Each row names its Source, which is what the roll-up renders.
      expect(rows[0]).toMatchObject({
        dataSourceId: aSource.id,
        dataSourceName: "A's roll-up",
      });
    });
  });

  describe('getPresignedUploadUrls', () => {
    it('server-mints one Job id + per-file upload id, keys nested under both', async () => {
      const source = await seedSource(userA, 'Minting');
      vi.mocked(generatePresignedUploadUrl).mockImplementation((key) =>
        Promise.resolve(`https://s3.test/${key}`),
      );

      const result = await createCaller(userA).documents.getPresignedUploadUrls(
        {
          dataSourceId: source.id,
          files: [
            { filename: 'a.pdf', contentType: 'application/pdf' },
            { filename: 'b.txt', contentType: 'text/plain' },
          ],
        },
      );

      expect(result.jobId).toMatch(/\S/);
      expect(result.uploads).toHaveLength(2);
      expect(generatePresignedUploadUrl).toHaveBeenCalledTimes(2);

      // Every key nests jobId AND the per-file uploadId, so same-named files in
      // one Job never collide: uploads/${jobId}/${uploadId}/${filename}.
      for (const upload of result.uploads) {
        expect(upload.s3Key).toBe(
          `uploads/${result.jobId}/${upload.uploadId}/${upload.filename}`,
        );
        expect(upload.uploadUrl).toContain(upload.s3Key);
      }
      // Per-file uploadIds are distinct.
      const ids = result.uploads.map((u) => u.uploadId);
      expect(new Set(ids).size).toBe(2);
      expect(result.uploads.map((u) => u.filename)).toEqual(['a.pdf', 'b.txt']);
    });

    it('rejects the whole batch when it would exceed the Source cap, naming the headroom', async () => {
      const cap = ragEnv.MAX_DOCUMENTS_PER_DATA_SOURCE;
      const headroom = 3;
      const source = await seedSource(userA, 'Nearly full');
      for (let i = 0; i < cap - headroom; i++) {
        await uploadDoc(txtFile(`fill-${i}-${crypto.randomUUID()}.txt`), {
          ownerId: userA.userId,
          dataSourceId: source.id,
        });
      }
      vi.mocked(generatePresignedUploadUrl).mockImplementation((key) =>
        Promise.resolve(`https://s3.test/${key}`),
      );

      await expect(
        createCaller(userA).documents.getPresignedUploadUrls({
          dataSourceId: source.id,
          files: Array.from({ length: headroom + 2 }, (_, i) => ({
            filename: `over-${i}.txt`,
            contentType: 'text/plain',
          })),
        }),
      ).rejects.toMatchObject({
        code: 'TOO_MANY_REQUESTS',
        message: `This data source has room for ${headroom} more documents.`,
      });

      // Whole-batch rejection, observed as outcome rather than as "S3 was never
      // called": nothing was minted, so there is no upload id, no key and no
      // progress state anywhere for this caller. (Read back through Redis, the
      // same surface a client would seed a refreshed panel from.)
      const snapshot = await readProgressSnapshot(userA.userId);
      expect(snapshot.uploads).toEqual([]);
      expect(snapshot.lastId).toBe('0-0');
    });

    it('admits a batch that exactly fills an empty Source, and rejects one more', async () => {
      // The `existing + N <= cap` boundary, bought without seeding a single
      // Document — an empty Source makes `N` alone the whole sum.
      const cap = ragEnv.MAX_DOCUMENTS_PER_DATA_SOURCE;
      const source = await seedSource(userA, 'Boundary');
      vi.mocked(generatePresignedUploadUrl).mockImplementation((key) =>
        Promise.resolve(`https://s3.test/${key}`),
      );
      const exact = await createCaller(userA).documents.getPresignedUploadUrls({
        dataSourceId: source.id,
        files: batchOf(cap),
      });
      expect(exact.uploads).toHaveLength(cap);

      await expect(
        createCaller(userA).documents.getPresignedUploadUrls({
          dataSourceId: source.id,
          files: batchOf(cap + 1),
        }),
      ).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' });
    });
  });

  describe('startIngestJob', () => {
    it('enqueues one job per batch (real queue read-back) and returns { jobId }', async () => {
      const source = await seedSource(userA, 'Enqueue');
      const { jobId, uploads } = await presignedBatch(userA, source.id);

      const result = await createCaller(userA).documents.startIngestJob({
        jobId,
        dataSourceId: source.id,
        uploads,
      });
      expect(result).toEqual({ jobId });

      // Read the job back off the real queue: one job under the jobId dedup key,
      // carrying the userId, the destination Source and the echoed uploads.
      const job = await _ingestQueue.getJob(jobId);
      if (!job) throw new Error('expected the job to be enqueued');
      expect(job.data.userId).toBe(userA.userId);
      expect(job.data.jobId).toBe(jobId);
      expect(job.data.dataSourceId).toBe(source.id);
      expect(job.data.uploads).toEqual(uploads);
    });

    it('rejects an s3Key that does not belong to the job (prefix guard)', async () => {
      const source = await seedSource(userA, 'Prefix guard');
      const { jobId, uploads } = await presignedBatch(userA, source.id);
      const [first] = uploads;
      if (!first) throw new Error('expected a presigned upload');

      await expect(
        createCaller(userA).documents.startIngestJob({
          jobId,
          dataSourceId: source.id,
          uploads: [{ ...first, s3Key: 'uploads/other-job/x/a.pdf' }],
        }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

      // Nothing enqueued on a rejected batch.
      expect(await _ingestQueue.getJob(jobId)).toBeUndefined();
    });

    it('translates an enqueue failure into a TRPCError', async () => {
      const source = await seedSource(userA, 'Enqueue failure');
      const { jobId, uploads } = await presignedBatch(userA, source.id);

      // Force the BullMQ edge to fail — the router must surface a TRPCError.
      const spy = vi
        .spyOn(_ingestQueue, 'add')
        .mockRejectedValueOnce(new Error('redis down'));

      await expect(
        createCaller(userA).documents.startIngestJob({
          jobId,
          dataSourceId: source.id,
          uploads,
        }),
      ).rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR' });

      spy.mockRestore();
    });
  });

  describe('delete', () => {
    it('removes only the named Document from the named Source', async () => {
      const source = await seedSource(userA, 'Deletable');
      const other = await seedSource(userA, 'Untouched');
      const filename = `shared-${crypto.randomUUID()}.txt`;
      // The same filename in two Sources is two Documents.
      await uploadDoc(txtFile(filename), {
        ownerId: userA.userId,
        dataSourceId: source.id,
      });
      await uploadDoc(txtFile(filename), {
        ownerId: userA.userId,
        dataSourceId: other.id,
      });

      const result = await createCaller(userA).documents.delete({
        dataSourceId: source.id,
        filename,
      });
      expect(result.deletedCount).toBeGreaterThan(0);

      const inSource = await createCaller(userA).documents.list({
        dataSourceId: source.id,
      });
      const inOther = await createCaller(userA).documents.list({
        dataSourceId: other.id,
      });
      expect(inSource).toEqual([]);
      expect(inOther.map((d) => d.filename)).toEqual([filename]);
    });

    it('reports zero deletions for a filename that was never indexed', async () => {
      const source = await seedSource(userA, 'Empty');
      const filename = `never-${crypto.randomUUID()}.pdf`;

      const result = await createCaller(userA).documents.delete({
        dataSourceId: source.id,
        filename,
      });

      expect(result).toEqual({ deletedCount: 0, fileName: filename });
    });
  });
});

describe('dataSourcesRouter', () => {
  afterEach(async () => {
    for (const source of sources.splice(0)) await deleteDataSource(source);
  });

  it("omits another user's Data Source from the caller's list", async () => {
    const aSource = await seedSource(userA, "A's source");
    await seedSource(userB, "B's source");

    const listed = await createCaller(userA).dataSources.list();

    expect(listed.map((s) => s.id)).toEqual([aSource.id]);
  });

  it('rejects a create that would exceed the per-user cap', async () => {
    const cap = ragEnv.MAX_DATA_SOURCES_PER_USER;
    for (let i = 0; i < cap; i++) await seedSource(userA, `Source ${i}`);

    await expect(
      createCaller(userA).dataSources.create({
        id: crypto.randomUUID(),
        name: 'One too many',
      }),
    ).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' });
  });

  it('hands the caps over as rag holds them, carrying no authority', async () => {
    // The client's checks are advisory, so what this procedure owes is the
    // CURRENT numbers rather than a copy: hardcoding them here or in the
    // client would be a second declaration to keep in step with a retunable
    // env. The authoritative check re-counts at presign and assumes this
    // response was never fetched.
    const limits = await createCaller(userA).dataSources.limits();

    expect(limits).toEqual({
      maxDataSourcesPerUser: ragEnv.MAX_DATA_SOURCES_PER_USER,
      maxDocumentsPerDataSource: ragEnv.MAX_DOCUMENTS_PER_DATA_SOURCE,
    });
  });

  it('reads the same caps for every caller — they are the deployment’s, not the user’s', async () => {
    await seedSource(userA, "A's source");

    expect(await createCaller(userB).dataSources.limits()).toEqual(
      await createCaller(userA).dataSources.limits(),
    );
  });

  it("rejects renaming and deleting another user's Data Source", async () => {
    const bSource = await seedSource(userB, "B's untouchable");

    await expect(
      createCaller(userA).dataSources.rename({
        id: bSource.id,
        name: 'Mine now',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    await expect(
      createCaller(userA).dataSources.delete({ id: bSource.id }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const bSources = await createCaller(userB).dataSources.list();
    expect(bSources.map((s) => s.name)).toEqual(["B's untouchable"]);
  });
});
