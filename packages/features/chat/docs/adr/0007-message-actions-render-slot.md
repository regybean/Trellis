# Per-message actions are an app-wired render slot, not a feature dependency

**Status:** accepted

## Context

Assistant Messages want per-message UI — thumbs up/down today, and whatever a
deployment adds next. The obvious implementation is for `ChatAssistant` to
render `FeedbackButtons` from `@acme/feedback`, since that is the only consumer
anyone has written.

That would make `@acme/chat` depend on `@acme/feedback`, and the two are
supposed to be siblings: one feature = one package, depending only downward.

## Decision

`ChatAssistant` takes `renderMessageActions(message)` and renders its result
beneath each settled assistant Message. Apps supply it. Chat names no action, no
button, and no sibling feature.

The slot fires only for **assistant** Messages that carry a real `id`. An
optimistic user Message and a streaming partial have nothing durable to act on,
so there is nothing an action could key off.

## Why

- **It keeps chat mountable alone.** Both slim apps mount chat without feedback.
  With a direct dependency, mounting chat would drag in a second feature's
  router, schema and env — the subsetting claim the 2×2 of apps exists to prove
  would quietly stop being true.
- **The coupling belongs to the app, and the app is where it already lives.** An
  app already knows it mounts both features; it is the only layer allowed to
  know that. Composing them is a prop in a page, not an edge in the graph.
- **It generalises for free.** Copy, retry, cite-sources are the same slot. Any
  of them as a chat feature would mean chat deciding what a Message affords.

## Considered and rejected

- **Import `FeedbackButtons` directly.** Fewer moving parts, and it is the whole
  problem: a features→features edge, and chat unmountable without feedback.
  Rejected.
- **Put the composed assistant in `@acme/ui`.** Shared UI cannot depend on
  either feature, so the assembly has nowhere to sit but an app. The
  compositions layer that would have owned it was removed. Rejected.
- **Have feedback register itself with chat at runtime** (a registry the app
  populates). Same wiring, but the type is `unknown` and the failure mode is a
  missing action at runtime rather than a compile error. Rejected — a prop is a
  registry with a type.
- **A generic slot per message region** (header, footer, inline). Rejected as
  speculative; one slot has one consumer, and a second region can be added when
  something needs it.

## Consequences

- The `done` and `cancelled` Stream terminals **must** carry `messageId`. That
  is the requirement this decision imposes on the wire contract: without the id
  arriving on the terminal, an action could not appear until the next
  `chat.get`. The persistence ordering that makes the id safe to act on — saved
  before the terminal is published — is ADR
  [0002](0002-mastra-memory-owns-conversation-persistence.md).
- Chat's tests render the slot with a stub, never with `@acme/feedback`. A test
  that reached for the real component would reintroduce the dependency through
  the back door.
- Apps that mount both features own the composition, including invalidating one
  feature's cache from the other's callback. The features stay ignorant of each
  other; the page does not.
