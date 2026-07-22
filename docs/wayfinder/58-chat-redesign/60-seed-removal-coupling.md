# Research: `initial` seed coupling & empty-state trigger (map #58, ticket #60)

Scope: how the seeded greeting flows through `use-chat.ts`, the safe way to
remove it so an empty conversation yields `messages.length === 0`, and what
`getAppInfo` fields are reused. AFK research — no code changed.

Files: `hooks/use-chat.ts`, `components/chat-assistant.tsx`,
`components/message-list.tsx`, `data/app-info.ts`,
`tests/frontend/integration/hooks/use-chat.test.tsx`.

## 1. Where `initial` flows

`useChat(initial, sessionId, onTokensConsumed)` — `initial: Message[]` is the
new/empty-conversation fallback. Today `chat-assistant.tsx:42-51` passes a
single-element array `[{ text: info.initialMessage, role: 'assistant' }]` (the
greeting). `initial` is read in exactly **two** derivation points, both fallbacks
when persisted history is empty:

- **`pickBase()` (`use-chat.ts:79-85`)** — the displayed list before the user
  interacts:
  - `historyQuery.isSuccess` → `historyQuery.data.length > 0 ? data : initial`
  - `historyQuery.isError` (new session → `chat.get` NOT_FOUND, `retry:false`) →
    `initial`
  - still loading → `[]`
    Then `base = pickBase()` and `messages = localMessages ?? base` (line 87).
- **`resumeSeed()` (`use-chat.ts:148-158`)** — resume-after-refresh: reads the
  freshest history from the query cache; `persisted = history.length > 0 ?
history : initial`, then appends a loading assistant bubble. Called from the
  subscription's `onStarted` adopt path (`:281`, `setLocalMessages(prev => prev
?? resumeSeed())`).

`initial` is **not** referenced anywhere else. It is display-only: never sent to
the server, never part of `send()`'s payload, never persisted. `send()` seeds
`localMessages` from `previous = localMessages ?? base` (`:346`) — so if the
greeting is in `base`, the greeting becomes the first element of the sent-list's
optimistic render, but only the typed `text` goes to `chat.send`.

## 2. What an empty seed (`initial = []`) does

Tracing each consumer with `initial = []`:

- **`pickBase`**: new/empty session (success-empty or error) now returns `[]`
  instead of the greeting. `base = []`.
- **`messages`**: `localMessages ?? []` → `[]` until first interaction. So
  `messages.length === 0` for a brand-new conversation — exactly the empty-state
  trigger we want.
- **`resumeSeed`**: `persisted = history.length > 0 ? history : []`. Resume only
  ever fires when a Turn is genuinely in flight for this conversation, which
  means at least the user Message was persisted at send — so `history` is
  non-empty in practice and the `: []` branch is unreachable on the real resume
  path. Even if it were hit, it would append the loading bubble to `[]`, giving a
  single loading assistant bubble (harmless, no phantom greeting). Safe.
- **`isHistoryLoading` (`:92`)**: `historyQuery.isLoading && localMessages ===
null` — unchanged; independent of `initial`. Skeleton still shows while a
  resumed conversation loads; a new session's `chat.get` resolves near-instantly
  (empty/NOT_FOUND) so it flips to `false` and we fall through to the empty
  state.
- **Resume-after-refresh path**: unchanged. `onStarted` adopt, `settleStream`,
  `reconcileOrAdopt` never read `initial`. The `assistants >= users && users >
0` orphan/adopt logic counts persisted roles, unaffected by a display-only
  greeting removal.
- **First `send()`**: `previous = localMessages ?? base = []`, so the optimistic
  list becomes `[user, loading-assistant]` with no leading greeting bubble — a
  cleaner first turn.

**Conclusion: `messages.length === 0` is a sound, sufficient empty-state
trigger**, true exactly when history has loaded (or errored) empty and the user
hasn't interacted. It is naturally false the instant `send()` seeds
`localMessages`, and false whenever persisted history exists.

## 3. Recommended removal approach

Two viable shapes; recommend **(A)**.

**(A) Drop the parameter (recommended).** Remove `initial` from `useChat`'s
signature; inline `initial` → `[]` at both `pickBase` and `resumeSeed` (or a
local `const EMPTY: Message[] = []`). Update the single caller
(`chat-assistant.tsx:42-51`) to `useChat(sessionId, onTokensConsumed)`. Cleanest:
the greeting concept leaves the hook entirely, no dead fallback lingers. Cost:
signature change ripples to the test helper `renderUseChat` /`renderChat`
(`use-chat.test.tsx:51-52, 246-255`) and the two greeting assertions
(`:67-74`, `:90-101`) which must flip to `expect(messages).toEqual([])`.

**(B) Keep the parameter, pass `[]` from the component.** Smaller diff
(`chat-assistant.tsx` only), hook untouched. But leaves a now-vestigial
"greeting" seam that invites re-seeding and misleads future readers. Prefer (A)
unless the map wants the minimal-diff path for a fast handoff.

Either way the **empty-state trigger for the component is `messages.length ===
0` (and `!isHistoryLoading`)** — render the centered title+description instead of
`<MessageList>`.

Note on `message-list.tsx`: with `[]` today it renders an empty `ScrollArea`
(`h-[700px]`, `data-testid="message-container"`). The layout ticket (#62) will
replace this region anyway; the empty state should be branched in
`chat-assistant.tsx` (or the new layout container), not inside `MessageList`.

## 4. `getAppInfo(...)` fields — reuse & orphans

`getAppInfo(webapp)` (`data/app-info.ts`) returns `AppInfo`:
`{ pageTitle, pageDescription, initialMessage, systemPrompt }`.

- **`pageTitle` / `pageDescription`** — currently the top hero in
  `chat-assistant.tsx:56-61`. **Reused** by the empty state: the map's
  destination is a centered title + description. Both apps share the same values
  today (`NextjsAppInfo` == `TanstackAppInfo`). Keep these fields; the empty
  state renders them centered in the message region instead of as a page hero.
- **`initialMessage`** — consumed **only** at `chat-assistant.tsx:45` to build
  the greeting seed. Removing the greeting **orphans `initialMessage`**. It is
  not read anywhere else (grep confirms). Recommend deleting the field from
  `AppInfo` and both app-info objects — but flag for #63 (consumer/test impact)
  in case any test or app asserts it; none found in this package.
- **`systemPrompt`** — consumed by `api/services/chat-agent.ts:25`
  (`instructions`). **Untouched** by this work; keep.

## Handoff notes for downstream tickets

- **#62 (layout)**: empty-state trigger is `messages.length === 0 &&
!isHistoryLoading`; render centered `pageTitle` + `pageDescription` there.
- **#63 (consumer/test impact)**: greeting-dependent assertions to retire —
  `use-chat.test.tsx` "shows greeting when chat.get returns empty" (`:67`) and
  "falls back to greeting when chat.get errors" (`:90`), plus the `greeting`
  fixture (`:39-41`) and `renderUseChat`/`renderChat` defaults. Any e2e asserting
  a seeded `bot-message` greeting on first load must change. `initialMessage`
  field removal to verify across apps.
- Recommend removal shape **(A)** (drop the param) unless minimal-diff is
  preferred.
