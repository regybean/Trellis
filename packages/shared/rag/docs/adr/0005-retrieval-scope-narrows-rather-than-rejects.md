# A retrieval scope narrows; a mutation rejects

**Status:** accepted

**Related:** [ADR 0004](0004-thread-ownership-rule-and-its-one-trpc-adapter.md) (the sibling ownership rule, which only rejects), [@acme/chat ADR 0009](../../../../features/chat/docs/adr/0009-per-turn-retrieval-scope.md) (the consumer this was written for).

## Context

`data_source` rows are hard-deleted. So when a caller presents an id the server
cannot find under their `owner_id`, the two cases are indistinguishable: it was
never theirs, or it was theirs until they deleted it a moment ago. One policy
has to cover both.

The first shape shipped rejected: `resolveRetrievalScope` called
`assertDataSourceOwned`, which throws `DataSourceOwnershipError` naming the
offending ids. That is right for a rename or a delete and wrong for retrieval.
A Turn resolves its scope when the worker runs it, which can be seconds or
minutes after the user ticked the boxes. Any Source deleted in that window — in
another tab, on another device — turned the whole Turn into an `error` terminal.
The user lost their message because a tick box went stale.

## Decision

**Ownership is one read with two policies over it, and the caller picks.**

`ownedDataSourceIds({ ownerId, dataSourceIds })` is the primitive: the owned
subset of a raw request, deduped, in request order, no query for an empty
request. Both policies are expressed over it:

- **`assertDataSourceOwned` rejects.** A mutation names one Source and must fail
  loudly when it is not the caller's — a silent no-op rename is worse than a 403. `deleteDataSource`, `renameDataSource` and ingest's upload path use this.
- **`resolveRetrievalScope` narrows.** Unowned and vanished ids are dropped from
  the scope; the Turn runs on what is left, or on nothing. `chat.send` and
  `streamScopedTurn` use this.

Narrowing is derived from the primitive rather than the other way round, so
there is no path on which a scope is built from ids nobody checked.

**Nothing is given away by dropping.** The filter's first clause is `owner_id =
<verified owner>`, so a foreign id that somehow survived narrowing would still
match no chunk. Dropping can only ever shrink the scope, which is the
fail-closed direction; the narrowing is a correctness and UX property on top of
a boundary that does not depend on it.

**`hasSources` is read off the narrowed set.** That is what makes it a fact the
caller cannot legally recompute: a Turn whose every Source was deleted since the
send has a non-empty raw array and an empty scope, and a caller counting its own
input would get that backwards.

## Considered and rejected

- **Reject, and have chat catch `DataSourceOwnershipError`.** Moves the same
  decision one layer up and spreads it: every future caller has to remember to
  catch, and one that forgets fails a Turn. Rejected — a policy that has to be
  remembered at each call site is the thing this module exists to avoid.
- **Reject only for ids the caller never owned, drop only deleted ones.** That
  distinction is the whole problem: the server cannot draw it. Doing so needs
  tombstone rows, which is a real design with real costs (name reuse, retention)
  bought for a 403 nobody acts on. Rejected.
- **Return the dropped ids so the caller can tell the user.** Tempting, and the
  reason it is not here is that the drop happens twice — once at `chat.send` and
  once when the worker runs — and only the first has a user attached. chat logs
  the send-time drop instead. Revisit if the picker ever needs to reconcile.

## Consequences

- An attacker presenting a stolen Source id gets silence rather than a 403. It
  retrieves nothing either way, so the only thing lost is an error message that
  would have confirmed the id exists.
- An empty scope is now reachable by staleness, not only by intent: a user whose
  every selected Source was deleted gets an ungrounded answer rather than an
  error. That is the trade — a degraded answer beats a lost message — and chat's
  `activeTools` branch reads `hasSources`, so the Turn at least costs no
  retrieval round trip.
- `assertDataSourceOwned` still exists and still throws. If it ever loses its
  last caller, the rejecting policy should be deleted rather than left as a trap
  for someone to pick up by accident.
