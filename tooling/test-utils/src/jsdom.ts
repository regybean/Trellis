/// <reference lib="dom" />

/**
 * jsdom gaps the Radix primitives rely on.
 *
 * The `dom` lib reference is file-scoped on purpose: the rest of
 * `@acme/test-utils` is backend infra and shouldn't see browser globals.
 *
 * A side-effect module: import it once from a package's frontend setup file.
 * Radix reads `ResizeObserver` and the pointer-capture / `scrollIntoView`
 * element APIs that jsdom doesn't implement, so any suite rendering an
 * `@acme/ui` primitive needs these installed before the first render. Every
 * frontend suite needed the same block, so it lives here rather than being
 * copied per package.
 *
 * Each element shim is applied only when absent, so a future jsdom that ships
 * the real API wins over the no-op.
 */

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
