# ADR Format

ADRs use sequential numbering within a `docs/adr/` directory: `0001-slug.md`, `0002-slug.md`, etc.

Create the directory lazily — only when the first ADR is needed.

## Where the ADR goes

A decision lives with what it governs, and the test is deletion: **if deleting the package would take the decision with it, the ADR belongs in that package's `docs/adr/`.** Otherwise it belongs in the repo-root `docs/adr/`. Citation counts are a tiebreak, never the rule.

Each directory owns its own sequence, **starting at `0001`**. Root and package numbering are independent, so the same number appearing in both is normal and correct — never renumber to avoid it.

## Template

```md
# {Short title of the decision}

{1-3 sentences: what's the context, what did we decide, and why.}
```

That's it. An ADR can be a single paragraph. The value is in recording _that_ a decision was made and _why_ — not in filling out sections.

## Optional sections

Only include these when they add genuine value. Most ADRs won't need them.

- **Considered Options** — only when the rejected alternatives are worth remembering
- **Consequences** — only when non-obvious downstream effects need to be called out

## When a decision changes

**Edit the ADR in place.** Write a new one only when the new decision is separable from the old — a genuinely different call, not a revision of this one.

An ADR that has been wholly overtaken is **deleted**, not archived as a tombstone. The reasoning behind the reversal survives in version control; a tree full of dead files does not help the next reader, and stub files re-collide with future numbers. The accepted trade-off: an ADR is not an append-only record.

If a project wants a machine-readable status, keep the vocabulary to `accepted` and `amended by <path>`. Deliberately omit `superseded by` — a superseded ADR is deleted, so it can never be a resting state.

"Stale" means superseded or never-built. It does **not** mean "the vendor named throughout is gone": if the ADR is still the only explanation of why the code is shaped the way it is, rewrite the vendor out of the prose rather than deleting the file.

## Numbering

Scan **the directory you are writing into** for the highest existing number and increment by one. Don't look at any other `docs/adr/` — sequences are per directory.

A gap in a sequence is fine. It is what a deleted ADR leaves behind, and closing it would break every link that points past it.

## When to offer an ADR

All three of these must be true:

1. **Hard to reverse** — the cost of changing your mind later is meaningful
2. **Surprising without context** — a future reader will look at the code and wonder "why on earth did they do it this way?"
3. **The result of a real trade-off** — there were genuine alternatives and you picked one for specific reasons

If a decision is easy to reverse, skip it — you'll just reverse it. If it's not surprising, nobody will wonder why. If there was no real alternative, there's nothing to record beyond "we did the obvious thing."

### What qualifies

- **Architectural shape.** "We're using a monorepo." "The write model is event-sourced, the read model is projected into Postgres."
- **Integration patterns between contexts.** "Ordering and Billing communicate via domain events, not synchronous HTTP."
- **Technology choices that carry lock-in.** Database, message bus, auth provider, deployment target. Not every library — just the ones that would take a quarter to swap out.
- **Boundary and scope decisions.** "Customer data is owned by the Customer context; other contexts reference it by ID only." The explicit no-s are as valuable as the yes-s.
- **Deliberate deviations from the obvious path.** "We're using manual SQL instead of an ORM because X." Anything where a reasonable reader would assume the opposite. These stop the next engineer from "fixing" something that was deliberate.
- **Constraints not visible in the code.** "We can't use AWS because of compliance requirements." "Response times must be under 200ms because of the partner API contract."
- **Rejected alternatives when the rejection is non-obvious.** If you considered GraphQL and picked REST for subtle reasons, record it — otherwise someone will suggest GraphQL again in six months.
