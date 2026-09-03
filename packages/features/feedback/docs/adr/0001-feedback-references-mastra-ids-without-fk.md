# Feedback references Mastra ids without a foreign key

**Status:** accepted — the first concrete instance of the app-owned lane in [@acme/rag ADR 0001](../../../../shared/rag/docs/adr/0001-mastra-rag-and-memory.md)

`message_feedback` is an app-owned, Drizzle-managed table that points at
Mastra-owned identifiers (`messageId`, `threadId`) but holds **no foreign key** to
the `mastra_*` tables. drizzle-kit owns this table's DDL; Mastra owns the DDL of the
tables it references. Integrity across the seam — "the thread is owned by the caller"
and "the message exists in that thread" — is enforced in the `submit` router, not by
a database constraint.

## Why

Mastra creates and owns its tables at runtime, and `db:push` is blacklisted from
`mastra_*` so drizzle-kit never manages them. A foreign key from `message_feedback`
to `mastra_messages` would force drizzle-kit to reference — and order itself against —
a table it does not own and cannot create, coupling the two ownership lanes and
reintroducing exactly the DDL race @acme/rag ADR 0001 removed. Carrying the ids by value keeps
the lanes independent: the feedback table can be pushed, dropped, and re-pushed
without touching Mastra, and Mastra can recreate its tables without knowing feedback
exists.

The trade-off is that referential integrity is no longer free. A `message_feedback`
row can outlive the `mastra_messages` row it names (e.g. if a Conversation is
deleted). We accept orphaned feedback rather than a cross-lane constraint:

- Reads are always user- and message-scoped, so an orphan is simply never returned.
- The write path validates what matters at submit time — thread ownership via
  `assertThreadOwned` and message existence via the `mastra_messages` mirror — so
  feedback can only be _created_ against a live, owned message.
- The dev database is ephemeral (no migrations, `db:push`), so orphan cleanup is not
  a production-data concern at this stage.

This makes integrity a property of the router's domain logic — the same place chat
already enforces ownership — rather than a property of the schema, which is the honest
location for a rule that spans two independently-owned storage lanes.

## Considered and rejected

- **Add a foreign key to `mastra_messages`.** Couples drizzle-kit to a Mastra-owned
  table, breaks the `!mastra_*` push scoping, and races on DDL ordering. Rejected —
  it undoes @acme/rag ADR 0001.
- **Mirror feedback into a Mastra store / message metadata.** Would make Mastra own
  feedback DDL, but feedback is app domain data with its own lifecycle (per-user
  upsert, toggle-off) that doesn't fit the message-metadata shape, and it would lose
  the app-owned-table demonstration that motivates this feature. Rejected.
- **A nightly/again-on-delete cleanup job for orphans.** Premature: there is no
  production data and Conversation deletion is rare. The scoped reads already hide
  orphans. Revisit if feedback gains cross-user analytics that scan all rows.

## Consequences

- `message_feedback` is the template for future app-owned tables: define columns in a
  feature package, re-export through the app's `db/schema.ts`, validate cross-lane
  references in the router.
- A Conversation deletion can leave orphaned feedback. Acceptable today; flagged here
  so a future analytics or retention requirement reopens it deliberately.
