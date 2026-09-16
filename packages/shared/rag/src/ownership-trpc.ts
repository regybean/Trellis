import 'server-only';

import { TRPCError } from '@trpc/server';

import { DataSourceOwnershipError, DataSourceQuotaError } from './data-source';
import { assertThreadOwned, ThreadOwnershipError } from './ownership';

// The single tRPC adapter for rag's transport-agnostic ownership rules — thread
// ownership (`ownership.ts`) and Data Source ownership (`data-source.ts`).
// Neither rule module knows any transport; each only knows "owned / absent /
// belongs-to-someone-else". This module is the ONE place that decides how those
// errors map onto tRPC, so a new ownership variant is handled here rather than
// re-expressed in every feature that annotates Mastra-owned data (chat's
// ownership builders, feedback's `submit`).
//
// Data Source ownership needs the same seam for the same reason thread ownership
// does: two consumers across two features want the identical FORBIDDEN —
// ingest's presign and chat's `send`.
//
// It is boundary-legal for `@acme/rag` (shared) to depend on `@acme/trpc`'s
// transport error type here: shared may depend on platform. Only
// `assertThreadOwned` (the rule) is transport-free; this adapter is the
// deliberate, named seam that consumes it. See
// [ADR 0004](../docs/adr/0004-thread-ownership-rule-and-its-one-trpc-adapter.md).

// Maps a caught error onto tRPC: a `ThreadOwnershipError` becomes FORBIDDEN;
// anything else is rethrown unchanged. Absence (a null thread) is NOT decided
// here — callers differ (chat's `stream`/`create` tolerate a not-yet-stamped
// thread as null; `get`/`delete` and feedback map absence to NOT_FOUND).
export function mapOwnershipError(error: unknown): never {
  if (error instanceof ThreadOwnershipError) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'You do not have access to this conversation',
    });
  }
  throw error;
}

// Convenience wrapper: run the ownership rule and map its only expected failure
// (foreign ownership) to FORBIDDEN in one place. Returns the owned thread, or
// null when the thread does not exist yet — callers decide whether absence is
// tolerated or a NOT_FOUND.
export async function assertOwnedThreadForTRPC(
  threadId: string,
  userId: string,
) {
  try {
    return await assertThreadOwned(threadId, userId);
  } catch (error) {
    mapOwnershipError(error);
  }
}

// Maps a caught error onto tRPC: a `DataSourceOwnershipError` becomes FORBIDDEN;
// anything else is rethrown unchanged. Absence is NOT a separate case here, and
// that is deliberate rather than an omission — `data_source` rows are
// hard-deleted, so the server cannot distinguish "was yours, now deleted" from
// "never was yours", and one policy has to cover both.
//
// FORBIDDEN is the right answer for the surfaces that ASSERT (presign, rename,
// delete): the caller named a specific Source it wants to act on. It is the
// wrong answer for `chat.send`, which drops unowned ids instead, because a ghost
// row in a stale panel would otherwise cost the user their message. Dropping can
// only ever narrow scope, which is the fail-closed direction.
export function mapDataSourceOwnershipError(error: unknown): never {
  if (error instanceof DataSourceOwnershipError) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'You do not have access to this data source',
    });
  }
  throw error;
}

// The whole Data Source failure vocabulary in one catch: foreign/absent
// ownership becomes FORBIDDEN (above), and hitting `MAX_DATA_SOURCES_PER_USER`
// becomes TOO_MANY_REQUESTS — the code this repo already uses for "your
// allowance is spent" (chat's credit exhaustion), rather than a BAD_REQUEST
// that would read as a malformed call.
//
// Separate from `mapDataSourceOwnershipError` rather than folded into it,
// because the assert-only surfaces (presign, rename, delete) cannot raise a
// quota error and a mapper that claimed to handle one would invite the reader
// to look for a cap that is not there. `create` is the only caller of this.
export function mapDataSourceError(error: unknown): never {
  if (error instanceof DataSourceQuotaError) {
    throw new TRPCError({
      code: 'TOO_MANY_REQUESTS',
      message: `You have reached the limit of ${error.cap} data sources`,
    });
  }
  mapDataSourceOwnershipError(error);
}
