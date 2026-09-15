# The optimistic cache protocol ships as a mutation-options fragment

**Status:** accepted

An optimistic list mutation on TanStack Query is five steps in one order:
cancel the queries in flight, snapshot the cached value, write the patch, roll
the snapshot back and report the failure on error, invalidate on settle. Only
the patch differs between mutations. `@acme/chat`'s conversation sidebar ran the
whole protocol four times in one module — move to folder, delete conversation,
create folder, delete folder — where the four patches are a map, a filter, an
append and a filter.

Repetition is the cheap part of the problem. The expensive part is that
`cancelQueries` must resolve **before** the snapshot is read, and neither way of
getting that wrong raises anything:

- A refetch still in flight lands its body over the patch, so the row the user
  just moved springs back for a moment.
- Worse, that body becomes the value the snapshot captures, so a later rollback
  restores pre-mutation server state with none of the user's intent in it.

Both are timing-dependent, so a call site that has the order wrong passes every
test that does not deliberately hold a fetch open.

## Decision

**`useOptimisticMutationOptions(taggedKey, patch)` returns the fragment; a
caller supplies a key and a patch and states nothing else.**

```ts
useMutation(
  trpc.chat.delete.mutationOptions(
    useOptimisticMutationOptions(listKey, (conversations, { sessionId }) =>
      conversations?.filter((c) => c.sessionId !== sessionId),
    ),
  ),
);
```

A fragment of options rather than a wrapper around `useMutation`, for the same
reason the persisted-query policy in
[ADR 0001](0001-per-query-indexeddb-persister.md) is one: the caller keeps
ownership of its mutation. It still reads as a `useMutation` on a tRPC
procedure, it can still spread its own `onSuccess` alongside, and nothing has to
re-export or re-type the mutation result. What moves is the policy, not the
call.

Three parts of the contract are load-bearing enough to name.

**The order is not a caller's to get wrong.** The fragment owns all three
callbacks, so there is no arrangement of the five steps a call site can express.
That is the whole return on the abstraction — line count is a side effect.

**Invalidating on settle, not on success, is what reconciles a client-minted
id.** A patch that appends a row the server also stores — a folder created with
a uuid the client minted, which the server inserts under that same id — leaves
the cache holding the optimistic copy. The refetch the invalidation triggers
replaces the list wholesale with the server's, so the row lands once rather than
twice. Running it on settle rather than success also makes it the backstop for
the one rollback that cannot work: `setQueryData` ignores `undefined`, so a
mutation whose query held nothing to snapshot has no prior value to restore, and
the refetch is what cleans up instead.

**The failure is reported, and that is not configurable.** Every rollback
undoes something the user asked for, so it goes through
`useGenericErrorHandler` — a toast, asserted as DOM text. Leaving it to the
caller would make a silently reverting list the default behaviour of the easiest
spelling. A mutation that needs a bespoke message adds its own handler around
the spread.

## The key must be tagged

`taggedKey` is typed `DataTag<QueryKey, TData, unknown>`, which accepts
`trpc.<path>.queryKey()` and TanStack's own `queryOptions({ … }).queryKey` and
rejects a bare array. The tag carries the cached value's type, so `previous` and
the patch's return are checked against the real query with no generic argument
and no cast at the call site. A hand-rolled key has to go through
`queryOptions()` first — which is how TanStack asks for keys to be declared
anyway.

Internally the key is re-read at `QueryKey` before it reaches
`getQueryData`/`setQueryData`. Passing the tagged type through leaves the
inferred read type deferred inside the generic, and getting `TData` back out of
it would need the cast this repo forbids.

## One caller, and why that was not disqualifying

Chat is the only feature doing optimism today; feedback and ingest both
invalidate on settle and never write ahead of the server. A seam with one caller
is usually a seam invented rather than found, and the ticket that produced this
ADR was explicit that "it does not pay" was an acceptable answer.

What decided it was the shape of the call sites afterwards. Each mutation went
from roughly twenty lines of protocol with a patch buried inside it to six lines
that are the patch, and the module lost a third of its length along with its
`useQueryClient` and error-handler wiring. The four sites are now the only place
that reads as four variations of one thing, because that is what they are.

The ordering argument carries the rest. Four copies of a rule whose violation is
invisible is four chances to break a user-visible list quietly, and there is now
one test holding a fetch open across a mutation to prove the cancel does its
job — a test that could not have been written against the inlined version
without writing it four times.

## Considered and rejected

- **Leave the protocol inline and describe the ordering in a comment.** The
  status quo, and it had the comment. A comment does not survive the fifth call
  site being written by someone who copied the fourth and reordered two lines
  while tidying.
- **A `useOptimisticMutation()` wrapper that owns `useMutation`.** Hides the
  mutation the caller is declaring, has to re-export its result type, and
  fights tRPC's `mutationOptions` for who builds the options object. The
  fragment composes; the wrapper replaces.
- **Take the patch as a TanStack `Updater` and let the caller close over its own
  variables.** Would mean building the fragment inside the mutation's own
  `onMutate`, which is exactly the callback being removed. Passing `variables`
  into the patch is what lets the call site be a single expression.
- **Accept an untagged `QueryKey` plus an explicit `TData` generic.** Works, and
  costs every call site a type argument that the key it already has is carrying.
- **Let the caller opt out of the error toast.** An option whose only honest
  default is "on" is not an option; a caller that wants different reporting can
  add a handler without one.
