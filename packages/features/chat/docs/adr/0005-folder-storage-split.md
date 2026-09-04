# Conversation Folders: split storage, lazy delete

**Status:** accepted

Conversation History lets a user group their Conversations into **Folders**. Two
facts have to live somewhere: the Folder _definition_ (its name, who owns it) and
the _assignment_ of a Conversation to a Folder. Conversations are Mastra Memory
threads (`@acme/rag`), whose DDL Mastra owns at runtime (@acme/rag ADR 0001); the chat
feature owns no thread table.

## Decision

The two facts are stored in two different places, on purpose:

- **Folder definitions** live in `chat_folder`, an app-owned, drizzle-kit-managed
  table (`id`, `userId`, `name`, `createdAt`) — the same ownership seam as
  `message_feedback` (@acme/rag ADR 0001). The feature defines the columns; each app
  re-exports it through `db/schema.ts` so push/generate own its DDL.
- **The assignment** lives on the Mastra thread as `metadata.folderId`, a single
  scalar. One field ⇒ a Conversation is in **at most one** Folder by
  construction — exclusivity needs no check and cannot drift.

Deleting a Folder removes only its `chat_folder` row. Member threads are **not**
rewritten: their `metadata.folderId` becomes a dangling id that no longer
resolves to any Folder, so the client treats those Conversations as un-foldered
and shows them under their Date Bucket. This is a **lazy delete** — no
per-Conversation write, no scan.

## Why

- A Conversation is Mastra-owned; bolting a `folderId` column onto a table we
  don't own isn't available. Metadata is the one writable, Mastra-blessed place
  to annotate a thread, and `setFolder` rides the same `updateThread` the title
  generator already uses.
- Folder definitions need querying, listing, and per-user scoping — a real
  relational table is the right home, and the `message_feedback` precedent
  already proves the app-owned-table seam.
- Single-scalar assignment makes the "never in two Folders at once" invariant
  structural rather than enforced.
- Lazy delete keeps the delete O(1) and pairs with an optimistic client cache
  edit: dropping the Folder from the cache re-groups its Conversations into Date
  Buckets instantly, with the server staying lazy. Every Folder list-mutation
  (`create` / `delete` / `setFolder`) is optimistic in `useConversations` —
  cancel in-flight refetches, snapshot, patch the cache, roll back on error,
  reconcile on settle — so the lazy server and the instant UI are two halves of
  one decision, not two independent ones.

The cost: a deleted Folder leaves dangling `folderId` values in thread metadata
forever. They are harmless (they resolve to nothing) but they accumulate. We
accept that for v1 rather than paying a write per member Conversation on delete.

## Folder ids are minted by the client

`chat.folders.create` takes the `id` as **input** rather than returning a
server-generated one, and the server inserts that id.

This is what lets the optimistic edit above be honest. A Folder the client
appends to the sidebar needs an identity immediately — to render, to be
`setFolder`'d into, and to be deleted — and if the server minted it, the
optimistic row would carry a placeholder that has to be swapped on settle. Two
things break with a placeholder: the row does not reconcile 1:1 (it is a remove
plus an insert, which the list rendering can see), and a `delete` issued before
the `create` settles has no real id to target, so it either no-ops or races.
With a client-minted id the same value is used end to end, so the optimistic and
settled states are literally the same row.

The cost is that `id` is caller-supplied on a write path, so it is validated as
a UUID and scoped to the caller like every other Folder operation; a client
cannot name another user's Folder because `userId` comes from the session, never
the input.

## Considered and rejected

- **One table owning both definition and assignment** (a `chat_folder` row plus a
  join table keyed by threadId). Rejected — it duplicates the Conversation
  identity the Mastra thread already owns and reintroduces a cross-seam foreign
  key that @acme/rag ADR 0001 deliberately avoids. Exclusivity would then need a unique
  constraint or a check instead of being free.
- **Assignment as a thread-metadata array of folderIds.** Rejected — an array
  invites a Conversation in multiple Folders, exactly the state the product
  forbids; a scalar makes the rule unrepresentable-when-violated.
- **Eager delete (rewrite every member thread's metadata to clear folderId).**
  Rejected for v1 — turns an O(1) delete into an O(members) batch of
  `updateThread` writes for a purely cosmetic cleanup the client already handles
  by failing to resolve the id. Revisit if dangling metadata ever needs reaping.
- **A folderId column on a chat-owned mirror of the threads table.** Rejected —
  Mastra owns thread DDL (@acme/rag ADR 0001); a parallel app-owned thread table would
  fork the source of truth for Conversation identity.
