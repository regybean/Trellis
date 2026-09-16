/**
 * `retrievalContextSchema` — unit tests.
 *
 * This file exists to protect the PERMISSIVE case, which is the counterintuitive
 * one. A future maintainer "hardening" the schema to require at least one Source
 * id would look like they were tightening security; what they would actually do
 * is convert every empty-scope Turn from a correct, silent retrieve-nothing into
 * a thrown validation error. That is invisible in review, and one assertion pins
 * it forever.
 *
 * The second case is `topK`. It has to be REQUIRED, because an optional key that
 * gets misspelled or refactored away is stripped silently, `get('topK')` returns
 * undefined, and retrieval reverts to an LLM-authored `topK` with no error at
 * all.
 */

import { describe, expect, it } from 'vitest';

import { retrievalContextSchema } from '../../../data-source';

const OWNER_ID = 'user_retrieval_context';

function context(filter: unknown, topK: unknown = 10) {
  return { filter, topK };
}

describe('retrievalContextSchema', () => {
  it('accepts an empty $in — "retrieve nothing" is a valid scope, not an error', () => {
    const parsed = retrievalContextSchema.safeParse(
      context({ owner_id: OWNER_ID, data_source_id: { $in: [] } }),
    );

    expect(parsed.success).toBe(true);
  });

  it('accepts a populated $in', () => {
    const parsed = retrievalContextSchema.safeParse(
      context({
        owner_id: OWNER_ID,
        data_source_id: { $in: [crypto.randomUUID(), crypto.randomUUID()] },
      }),
    );

    expect(parsed.success).toBe(true);
  });

  it('rejects a context with no topK', () => {
    const parsed = retrievalContextSchema.safeParse({
      filter: { owner_id: OWNER_ID, data_source_id: { $in: [] } },
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects a context with no filter — this is what turns Mastra's worst fail-open hole into a crash", () => {
    // Passing no request context at all validates `{}`, so a required `filter`
    // is the difference between a loud throw and a silent full-corpus read.
    expect(retrievalContextSchema.safeParse({}).success).toBe(false);
    expect(retrievalContextSchema.safeParse({ topK: 10 }).success).toBe(false);
  });

  it('rejects an empty owner_id — the privacy boundary cannot be a blank string', () => {
    const parsed = retrievalContextSchema.safeParse(
      context({ owner_id: '', data_source_id: { $in: [] } }),
    );

    expect(parsed.success).toBe(false);
  });

  it('rejects a non-uuid Source id', () => {
    const parsed = retrievalContextSchema.safeParse(
      context({ owner_id: OWNER_ID, data_source_id: { $in: ['not-a-uuid'] } }),
    );

    expect(parsed.success).toBe(false);
  });

  it('rejects a topK that is not a positive integer', () => {
    const filter = { owner_id: OWNER_ID, data_source_id: { $in: [] } };

    expect(retrievalContextSchema.safeParse(context(filter, 0)).success).toBe(
      false,
    );
    expect(retrievalContextSchema.safeParse(context(filter, 2.5)).success).toBe(
      false,
    );
  });
});
