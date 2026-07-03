# Frontend tests fake the network at the HTTP boundary and assert what renders

A frontend test wires the real React tree to a real TanStack `QueryClient` and
fakes the network at the **HTTP boundary** with MSW (`msw-trpc` +
`setupServer`). It never `vi.mock`s a seam the feature owns — the tRPC client
(`trpc/react`), the feature's own hooks (`../hooks/*`), or `react-toastify` —
and it asserts the **observable outcome** (rendered DOM, returned hook state,
cache contents), never `expect(mock).toHaveBeenCalledWith(...)`. This is the
frontend counterpart to the backend's one principle ([docs/TESTING.md](../TESTING.md)):
*test the contract, not the internals.*

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
makes it the *only* way in.

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
*cannot run*. A toast is not that — `react-toastify` renders in jsdom. So the
doctrine forbids mocking it and requires asserting the message text through a
real `<ToastContainer />` in the DOM. This keeps one consistent rule ("assert
what renders") rather than carving a mock-call exception that reopens the door
the tRPC-client ban closes. Framework externals that genuinely can't be observed
in jsdom — `next/navigation`, `@acme/auth` — remain mockable, mirroring the
backend's blessed mock list (ADR 0014); prefer observable navigation
(`<Link href>` in the DOM) over asserting an imperative `router.push`.

## Enforcement

The structural rules are machine-checked; the assertion rule follows from them:

- **ESLint** (`no-restricted-syntax`, `tooling/eslint/base.ts`, scoped to
  `**/tests/frontend/**`) bans `vi.mock` of `trpc/react`, `../hooks/*`, and
  `react-toastify`. Because the data-layer spy can no longer be created, a
  data-layer `toHaveBeenCalledWith(...)` becomes *impossible to write* — the
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
