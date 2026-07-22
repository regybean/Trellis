## Destination

A handoff-ready spec for reskinning the `@acme/chat` feature surface to feel like a modern ChatGPT-style app, covering four asks:

1. Input pinned to the bottom of the screen (full-height layout).
2. Seeded first assistant message removed, replaced by a centered title+description empty state.
3. Previous-chats history collapsible — both a whole-sidebar toggle and per-section collapse.
4. The double scroll in the chat window removed (single scroll region).

Done when every decision below is locked and someone could implement without further design calls. **Plan/spec only — no code changes in this map** (execution is a separate session).

## Notes

- Domain: front-end redesign of one feature slice, `packages/features/chat`. Consumed by `apps/nextjs` and `apps/nextjs-slim` (mounted at `app/chat-assistant/[[...sessionId]]/`), and must stay runtime-agnostic per ADR 0010 — no framework/shell specifics leak into the feature.
- Shell/chrome is app-owned; the feature is a full-height consumer (`ConversationView` already `h-full min-h-0`). The height contract between the two is an explicit decision (T1).
- Skills to use per ticket type: `/grilling` + `/domain-modeling` (grilling), `/research` (research), `/prototype` (prototype), `/to-spec` (final assembly).
- Key files: `components/chat-assistant.tsx` (Card/hero framing, seed injection), `components/conversation-view.tsx` (outer overflow-auto), `components/message-list.tsx` (ScrollArea h-[700px]), `components/conversation-sidebar.tsx` (fixed w-72, folders + date buckets), `hooks/use-chat.ts` (seed `initial` woven into pickBase + resumeSeed).
- Decided at charting: plan-only; full ChatGPT-style rework (drop Card/hero); collapsible = both; empty state = title + description (no starter prompts).

## Decisions so far

<!-- one line per closed ticket -->

- [[chat] Chat pane height & single-scroll contract](https://github.com/regybean/Trellis/issues/59) — bounded-parent contract (feature `h-full min-h-0`, app owns height derivation); chat pane is a full-height flex column with the message region as the sole scroller (`flex-1 min-h-0 overflow-y-auto`, drop `overflow-auto` + `h-[700px]`), sidebar scrolls independently; replace radix `ScrollArea` with a native ref'd overflow div (auto-scroll via `ref.scrollTop = scrollHeight`, drop the `data-radix-scroll-area-viewport` querySelector).

## Not yet specified

- Responsive / mobile behaviour of the full-height layout and the collapsed sidebar (rail vs off-canvas) — hangs on the layout structure (T1/layout ticket).
- Auto-scroll-to-bottom and any "jump to latest" affordance under the new single-scroll region — may graduate from the layout prototype.

## Out of scope

- Any backend / streaming / persistence change (durable stream, tRPC procedures).
- Folder drag-and-drop behaviour changes beyond adding collapse.
- Theming/tokens beyond what the layout restructure requires; new starter-prompt content.
