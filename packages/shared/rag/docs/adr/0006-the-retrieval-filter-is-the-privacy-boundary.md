# The retrieval filter is the privacy boundary

**Status:** accepted

**Related:** [ADR 0005](0005-retrieval-scope-narrows-rather-than-rejects.md) (the
narrowing policy that rides on this boundary) and
[ADR 0004](0004-thread-ownership-rule-and-its-one-trpc-adapter.md) (the sibling
ownership rule, over threads rather than chunks).

## Context

The knowledge base used to be one undivided corpus. An operator curated it, every
signed-in user retrieved over all of it, and that was defensible because nothing
in it was anybody's in particular. Once users upload their own files, the same
store holds documents belonging to different people and "retrieve over the
knowledge base" is a cross-user read.

Mastra's vector-query tool fails **open**, twice over. A `stream` call whose
request context carries no `filter` resolves `enableFilter: false` and retrieves
over the whole corpus — no error, no warning, a plausible answer at the end of
it. And an empty-object filter is worse than none: the tool reads `{}` as "enable
filtering", then drops the empty filter and runs unfiltered on the fast path.
Both failures produce good-looking output, which is the only kind of failure
nobody catches in review.

So the question was not "where do we add a check". It was which artifact is the
boundary, given that the framework's default is to have none.

## Decision

**Retrieval scope is a server-built metadata filter derived from the verified
`userId`, and that filter is the privacy boundary.** Everything else — the
partition, the validator, the single call site — exists to make that one sentence
true.

Three parts.

**Every chunk carries its owner.** `dedupeChunks` stamps `owner_id` and
`data_source_id` into each chunk's metadata at upload, keyed through `SCOPE_KEYS`
so a rename of either key is a compile error at the writer, the validator and the
filter at once. A **Data Source** is a named partition of one owner's corpus;
there is no chunk outside one.

**The filter is built here and nowhere else.** `buildDataSourceFilter` is not
exported. The only public way to obtain a retrieval context is
`resolveRetrievalScope`, which resolves ownership itself from the caller's
verified `userId` and takes nothing about ownership from the request. The filter
is always the same two clauses — `owner_id` equality, then `data_source_id $in`
— with no branch between them: `owner_id` is the boundary, `data_source_id` is
scope selection, and "retrieve nothing" is `{ $in: [] }` rather than a different
shape. `{}` is unconstructible through the module's public surface.

**The corpus is partitioned because the filter is the boundary.** These are not
two decisions. A partition nobody enforces is a naming convention; an enforced
filter over an unpartitioned corpus has nothing to select. Recording them apart
would let either half be reversed on its own, and reversing either half is the
leak.

Backing all three, `retrievalContextSchema` declares `filter` and `topK`
**required**, and Mastra validates it at the top of `stream`/`generate` before
any LLM call. That turns the framework's worst fail-open hole into a loud crash:
a call passing no request context validates `{}` against a required `filter` and
throws, rather than retrieving over everything. `topK` is required for the same
reason — a key stripped by a refactor reverts retrieval breadth to the model's
choice with no error.

## Considered and rejected

- **Let the agent author its own filter** (`enableFilter: true`, the filter in
  the tool's LLM-facing schema). This was live, and it is the shape Mastra's
  documentation reaches for first. Rejected: it makes the privacy boundary a
  token sequence a model emits, so a prompt injection in a retrieved chunk is a
  privilege escalation. `enableFilter` is deliberately left off the tool, and a
  request-context filter self-enables filtering anyway, so there is no capability
  lost.
- **Bypass Mastra's tool and query pgvector directly** — our own SQL, our own
  `WHERE owner_id = $1`. Genuinely attractive: a real index gets used (see the
  scan finding below), and the boundary becomes a SQL predicate rather than a
  metadata convention. Rejected because it means owning query construction,
  embedding of the query text, result shaping and the agent-tool adapter around
  all of it — replacing a boundary we can state in one function with a seam whose
  correctness is spread across four. Worth revisiting only if the index remedy
  below turns out not to be enough.
- **Keep the curated global corpus alongside per-owner Sources**, as an `OR
global` branch in the filter. Rejected: the branch is exactly where a leak
  hides, because the failure mode is "the wrong things matched the global arm"
  and no test distinguishes that from "the global arm worked". A deployment that
  wants shared documents can give the shared owner's Sources to its users.
- **Treat an empty selection as "retrieve over everything"**, the way a missing
  filter already behaves. Rejected — it makes the default case the unfiltered
  case, and the default case is the common one. The empty set means retrieve
  nothing.

## Consequences

- **The admin-curated global corpus is gone.** There is no unowned chunk and no
  `OR global` arm, so the filter has no second branch for a leak to hide in.
  Restoring shared documents means restoring that branch, which is why it is
  written down here rather than discovered in a diff.
- **Client-minted Data Source ids are safe _only_ because `owner_id` is
  unconditionally in the filter.** Ids are minted in the browser, so a caller can
  present any UUID it likes. Nothing about that is checked cryptographically and
  nothing needs to be: an id that is not the caller's narrows away, and one that
  somehow survived narrowing still matches no chunk, because the first clause
  pins the owner. Anyone tempted to make the second clause conditional — "skip
  `$in` when the user selected everything" — is removing the reason the first
  clause carries the guarantee alone.
- **Every filtered query is a sequential scan over the app's whole corpus, and
  never touches HNSW.** Mastra's `metadataIndexes` emits `->>` while its filter
  compiles to `#>>`; those are different immutable functions and the planner does
  not equate them, so the declared index is never used. With the step budget
  pinned at five, the worst case is up to four whole-corpus scans per Turn. The
  remedy is an app-owned expression index on `(metadata #>> '{owner_id}')`,
  measured to work — but **taking it requires amending
  [ADR 0001](0001-mastra-rag-and-memory.md) first**, because it would be the
  first app-owned DDL on a `mastra_*` table and that ADR's invariant is that
  Mastra owns all of it. The amendment is not made here: the index is deferred,
  so the invariant is still true today, and documenting a carve-out nobody has
  taken would make that ADR less accurate rather than more.
- **Consumers get one streaming call site, and it is lint-enforced in the
  consuming package.** A boundary built into `resolveRetrievalScope` only holds
  if every agent stream goes through a wrapper that calls it, and that wrapper
  lives with the agent, not here. `@acme/chat` bans `chatAgent.stream` outside
  its own wrapper with a `no-restricted-syntax` rule; the constraint is restated
  rather than linked, because it is that package's decision and its own ADRs
  record it. Any future consumer that streams an agent against this filter owes
  itself the same single-call-site rule — `resolveRetrievalScope` cannot enforce
  it from here.
- **The module sits behind `./server`.** The root entrypoint already carries
  `import 'server-only'`, so that is not the reason. The reason is that the
  module holds two Drizzle clients — the app database for `data_source`, the
  vector database for the chunk cascade — and exports neither, because an
  exported client is a path around the ownership predicate. `./server` is where a
  reader looks for "server-only, holds a connection", and keeping it there means
  the import graph says so before the file does.

## A limit on the claim

The validator backstop covers the Agent's `stream`/`generate` path **and nothing
else.** Mastra validates `requestContextSchema` at the top of those two methods;
workflow steps have separate input handling behind a `validateInputs` flag the
Agent path does not have. Today there is exactly one `stream` call and no
workflow wraps this agent, so the gap is not reachable — but it is a gap in the
_claim_, not a consequence of it, and an ADR that says "structurally fail-closed"
while omitting the one uncovered path is overclaiming.

It is stated here rather than in a comment because there is no workflow file to
comment on. If anything ever wraps an agent carrying `retrievalContextSchema` in
a Mastra workflow, this backstop's coverage must be rechecked before that
workflow ships.
