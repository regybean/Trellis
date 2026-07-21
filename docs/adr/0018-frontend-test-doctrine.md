# Frontend tests fake the network at the HTTP boundary and assert what renders

A frontend test wires the real React tree to a real TanStack `QueryClient` and
fakes the network at the **HTTP boundary** with MSW (`msw-trpc` +
`setupServer`). It never `vi.mock`s a seam the feature owns — the tRPC client
(`trpc/react`), the feature's own hooks (`../hooks/*`), or `react-toastify` —
and it asserts the **observable outcome** (rendered DOM, returned hook state,
cache contents), never `expect(mock).toHaveBeenCalledWith(...)`. This is the
frontend counterpart to the backend's one principle ([docs/TESTING.md](../TESTING.md)):
_test the contract, not the internals._

## Why the network boundary is the only seam

The [slice contract](../../CLAUDE.md) puts a feature's logic in `src/hooks/` and
keeps components presentational. So the **hook is the frontend's contract** — the
analog of a tRPC procedure on the backend. A test that `vi.mock`s
`../trpc/react` (as `ingest/documents-list` and `ingest/upload-documents-button`
once did) replaces the very seam it should exercise with a hand-built query
shape, then asserts `expect(deleteSpy).toHaveBeenCalledWith(...)` — testing the
mechanism, not the outcome. The same test through MSW runs the real hook, the
real `QueryClient`, the real cache-invalidation wiring, and asserts the row
leaving the DOM. One is a change-detector; the other proves the contract.

Faking at the HTTP boundary is possible because each feature's
`trpc/react.tsx` already switches to a plain `httpLink` under `NODE_ENV==='test'`
specifically so MSW can intercept it. The infrastructure was there; the doctrine
makes it the _only_ way in.

## "integration" means something weaker on the frontend

The taxonomy reuses the backend's `unit` / `integration` folders, but the words
map differently — the mapping is documented in
[docs/TESTING.md](../TESTING.md):

- **`unit/`** — pure logic, no React tree, no providers, no network. Solitary.
- **`integration/hooks/`** — a hook driven through a real `QueryClient` + MSW;
  assert returned state and cache transitions. This is the contract layer.
- **`integration/components/`** — a component rendered through its providers;
  assert DOM. MSW when it composes a hook; bare props when it's presentational.

On the backend, "integration" means **real infra** (Postgres/Redis). The
frontend has no real-infra tier — **MSW is the frontier**, jsdom is the runtime.
So a frontend "integration" test is sociable but still hermetic. Naming this
asymmetry explicitly is the point: the shared vocabulary would otherwise imply a
fidelity the frontend tests don't have.

## Toasts are output, not an external

The backend mocks Stripe/S3/Bedrock because they are network side-effects it
_cannot run_. A toast is not that — `react-toastify` renders in jsdom. So the
doctrine forbids mocking it and requires asserting the message text through a
real `<ToastContainer />` in the DOM. This keeps one consistent rule ("assert
what renders") rather than carving a mock-call exception that reopens the door
the tRPC-client ban closes. Framework externals that genuinely can't be observed
in jsdom — `next/navigation`, `@acme/auth` — remain mockable, mirroring the
backend's blessed mock list (ADR 0014); prefer observable navigation
(`<Link href>` in the DOM) over asserting an imperative `router.push`.

## SSE subscriptions: assert the mutations, not the stream

`@acme/chat`'s durable-stream flow (spec #44) splits a chat turn across a tRPC
**subscription** (`chat.stream`, a pure SSE reader of a Redis Stream) and three
**mutations** (`chat.send` / `chat.stop` / `chat.reconcileTurn`). The subscription
is where this doctrine's HTTP-boundary fake stops working: **MSW cannot drive a
tRPC SSE subscription in jsdom.** Under `NODE_ENV==='test'` the client routes
subscriptions through `httpSubscriptionLink` (query/mutation still go through the
MSW-interceptable `httpLink`), and an enabled reader only ever transitions
`connecting → error` — it never delivers `onData` deltas/terminals or a clean
`idle` close. So token append and the `done`/`cancelled`/`error` terminal
outcomes are **not assertable** in a frontend test.

The workaround follows the layer split the slice contract already draws:

- **Mutations are the contract, and they are MSW-interceptable.** Assert
  `chat.send` (`accepted` → in-flight + optimistic prepend; `alreadyInflight` →
  attach, no re-send), `chat.stop` (settles), and `chat.reconcileTurn` (refund)
  through the real hook in `integration/hooks/` — exactly as any other mutation.
- **Streaming outcomes are documented, not asserted.** The token-append /
  terminal cases live as notes in the component test
  (`integration/components/chat-assistant.test.tsx`), which asserts only the
  synchronous optimistic state `send()` writes before the reader ever resolves.
- **The orphan path bridges both.** The reader closing _without_ a terminal is a
  real production signal (a crashed worker), and it maps onto the one lifecycle
  jsdom does produce: the subscription's unrecoverable `error`. The hook treats
  "closed, owned turn, no terminal" as an orphan and fires `chat.reconcileTurn`,
  so its refund toast **is** asserted here — through the real `<ToastContainer />`,
  never a mocked `toast` (this is why the chat test wrapper now mounts one).

This keeps the rule intact — assert what renders, fake only at the HTTP boundary
— by scoping the un-fakeable seam (the SSE transport) to notes and pushing every
assertable edge onto the mutations and the DOM.

## Enforcement

The structural rules are machine-checked; the assertion rule follows from them:

- **ESLint** (`no-restricted-syntax`, `tooling/eslint/base.ts`, scoped to
  `**/tests/frontend/**`) bans `vi.mock` of `trpc/react`, `../hooks/*`, and
  `react-toastify`. Because the data-layer spy can no longer be created, a
  data-layer `toHaveBeenCalledWith(...)` becomes _impossible to write_ — the
  precise ban subsumes a blunt "no mock-call assertions" rule without
  false-positiving on legitimate framework-external assertions.
- **`scripts/check-test-policy.mjs`** requires every `*.test.tsx` to sit under
  `unit/`, `integration/hooks/`, or `integration/components/`, and extends the
  unit-purity check (no `vi.mock`/`vi.spyOn`/`vi.fn`) to `frontend/unit/`.

## Status

accepted

## Considered and rejected

- **Blanket-ban all `toHaveBeenCalled*` in frontend tests.** Rejected — too
  blunt: it would flag the one legitimate remaining use (observing imperative
  navigation on a mocked `next/navigation`) and exceed the backend's own
  enforcement altitude, which leaves the assertion rule as doctrine. The precise
  `vi.mock` ban reaches the same end structurally.
- **Allow `vi.mock('react-toastify')` as a blessed external** (assert the call).
  Rejected — the toast renders in jsdom, so it's observable output; mocking it
  reintroduces mock-call assertions for a thing we can just read from the DOM.
- **Keep the shallow-mock style** (`vi.mock('../trpc/react')`) as an allowed
  alternative to MSW. Rejected — two mocking strategies is exactly the drift the
  backend eliminated with one canonical test context; the shallow style also
  can't exercise the real hook + cache wiring, which is the contract.
- **Coin frontend-native folder names** (`hooks/` / `render/` instead of reusing
  `unit`/`integration`). Rejected — the team preferred one shared vocabulary
  across BE/FE with a documented mapping over two parallel taxonomies.
