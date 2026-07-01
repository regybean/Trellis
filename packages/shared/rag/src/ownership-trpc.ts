import { TRPCError } from '@trpc/server';

import { assertThreadOwned, ThreadOwnershipError } from './ownership';

// The single tRPC adapter for the transport-agnostic thread-ownership rule
// (`ownership.ts`). `ownership.ts` itself stays free of any transport — it only
// knows "owned / absent / belongs-to-someone-else". This module is the ONE place
// that decides how a `ThreadOwnershipError` maps onto tRPC, so a new ownership
// variant is handled here rather than re-expressed in every feature that
// annotates Mastra-owned data (chat's ownership builders, feedback's `submit`).
//
// It is boundary-legal for `@acme/rag` (shared) to depend on `@acme/trpc`'s
// transport error type here: shared may depend on platform. Only `assertThreadOwned`
// (the rule) is transport-free; this adapter is the deliberate, named seam that
// consumes it — see chat CONTEXT.md ("the ownership rule itself lives in @acme/rag").

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
