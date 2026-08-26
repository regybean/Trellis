import '@testing-library/jest-dom';

// `@acme/ui` is presentational — no network, no providers, no tRPC client — so
// this suite needs no MSW server (ADR 0018's HTTP-boundary fake has nothing to
// intercept here). Components take their data and handlers as props and the
// tests assert what renders.

// --- jsdom gaps the Radix primitives rely on -----------------------------
class ResizeObserverMock {
  observe() {
    // no-op
  }
  unobserve() {
    // no-op
  }
  disconnect() {
    // no-op
  }
}
globalThis.ResizeObserver = ResizeObserverMock;

if (!('hasPointerCapture' in Element.prototype)) {
  // @ts-expect-error - jsdom doesn't implement this API
  Element.prototype.hasPointerCapture = () => false;
}
if (!('setPointerCapture' in Element.prototype)) {
  // @ts-expect-error - jsdom doesn't implement this API
  Element.prototype.setPointerCapture = () => {
    // no-op
  };
}
if (!('releasePointerCapture' in Element.prototype)) {
  // @ts-expect-error - jsdom doesn't implement this API
  Element.prototype.releasePointerCapture = () => {
    // no-op
  };
}
if (!('scrollIntoView' in Element.prototype)) {
  // @ts-expect-error - jsdom doesn't implement this API
  Element.prototype.scrollIntoView = () => {
    // no-op
  };
}
