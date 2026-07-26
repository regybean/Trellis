import { z } from 'zod/v4';

/**
 * Raised whenever config fails to validate — an invalid profile value, a
 * missing key the base profile should have provided, or an unknown `APP_ENV`.
 * Wraps the raw `ZodError` (per ADR 0026) and renders a human-readable message
 * via `z.prettifyError`; consumers that want structured detail read `.zodError`.
 */
export class ConfigValidationError extends Error {
  constructor(readonly zodError: z.ZodError) {
    super(`Config validation failed:\n${z.prettifyError(zodError)}`);
    this.name = 'ConfigValidationError';
    // Restore the prototype chain — `extends Error` loses it when the output
    // targets ES5-era runtimes, which breaks `instanceof`.
    Object.setPrototypeOf(this, ConfigValidationError.prototype);
  }
}
