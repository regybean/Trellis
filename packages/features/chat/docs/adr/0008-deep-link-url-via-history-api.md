# The Conversation deep link is reconciled with the History API, never the router

**Status:** accepted

## Context

A Conversation should be linkable: refresh mid-answer, or send someone the URL,
and you land back in the same Conversation. The framework-native way to do that
is a router navigation to `/<base>/<sessionId>` when the selection changes.

Chat cannot use it. The assistant's tokens arrive over a live SSE subscription
held by the mounted component. A router navigation refetches and remounts the
route segment, which **tears that stream** — and in the Next.js app also
invalidates the App Router cache for the segment. The user watches the answer
stop mid-sentence at the exact moment the URL becomes shareable.

## Decision

`ConversationView` owns the current `sessionId` and reconciles the address bar
itself, imperatively, at the three moments the answer changes:

- **`replaceState`, not `pushState`.** The URL is a bookmark for the current
  Conversation, not a navigation step. `pushState` would build a back-stack of
  entries and oblige us to handle `popstate` to keep state in sync with it.
- **`replaceState`, never the framework router.** For the reason above. This is
  the load-bearing half: reversing it is a one-line change that silently breaks
  streaming, and it will look like a cleanup.
- **Pass the existing `history.state` through**, not `null`. Next patches
  `replaceState` and keeps per-entry router bookkeeping in that object;
  discarding it corrupts the client router's cache.
- **Reconciliation is imperative, never a mount effect.** It happens on select,
  on "New chat", and on first send. `syncUrl` no-ops when the URL already
  matches, so a deep link on mount and a resend both cost nothing.

**The id is cosmetic until the first Message is sent.** No thread, no rows, no
sidebar entry exists before `chat.send`, so a URL carrying that id would 404 on
reload. The URL therefore only carries an id once the Conversation is actually
resumable:

| Moment                    | URL                                      |
| ------------------------- | ---------------------------------------- |
| New chat (id minted)      | stays bare                               |
| First send                | stamped, threaded up from `useChat.send` |
| Select / deep link resume | stamped immediately (already real)       |

Stamping on first send rather than on mount is what makes a mid-generation
refresh work: by the time the id is in the URL, the durable stream and the
worker behind it can be rejoined.

## Considered and rejected

- **Router navigation on selection.** The framework-idiomatic answer, and the
  bug this ADR exists to prevent. Rejected.
- **`pushState` so Back walks the Conversation history.** Plausible product
  behaviour, but it requires a `popstate` listener reconciling external
  navigation against component state — new state to keep in sync for a
  behaviour nobody asked for. Rejected; revisit if Back-through-Conversations
  is ever wanted.
- **Stamp the URL on mount, when the id is minted.** Simpler (one effect, no
  threading through the hook), and it puts an unresolvable id in a shareable URL:
  reload a never-sent Conversation and the deep link loads nothing. Rejected.
- **Let the app own URL reconciliation entirely.** The app does own its route
  and passes `basePath` in — but the moments that require a stamp are
  chat-internal (first send is inside `useChat`), so an app-owned version means
  exporting those moments as callbacks and trusting every app to wire all three.
  Rejected: the feature stamps the id onto a path the app names.

## Consequences

- `ChatAssistant` is keyed by `sessionId`, so resuming a **past** Conversation
  remounts deliberately to load its history — while typing the first Message of
  a new Conversation does not, because the id was minted before the render.
- `ConversationView` cannot be replaced by an app-owned frame without
  reimplementing this rule. An app that wants its own shell should mount
  `ChatAssistant` and copy the `syncUrl` behaviour, not reach for its router.
- `conversation-view.test.tsx` pins the URL **lifecycle** against a real
  `history` — bare on a new Conversation, stamped on first send, a deep link
  left untouched on mount, bare again on "New chat". It does not pin the
  _mechanism_: a regression to a router navigation would have to be caught in
  review, which is the reason this ADR exists rather than only the code
  comment.
