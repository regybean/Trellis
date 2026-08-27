import '@testing-library/jest-dom';
// jsdom gaps the Radix primitives rely on (ResizeObserver, pointer capture).
import '@acme/test-utils/jsdom';

// `@acme/ui` is presentational — no network, no providers, no tRPC client — so
// this suite needs no MSW server (ADR 0018's HTTP-boundary fake has nothing to
// intercept here) and no `renderWithProviders`: components take their data and
// handlers as props and the tests `render` them directly. That's why this is a
// plain `setup.ts` rather than the feature recipe's `setup.tsx` (docs/TESTING.md
// § "Setup and config") — there is no provider tree to wrap, so no JSX.
