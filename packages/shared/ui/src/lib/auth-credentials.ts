import { z } from 'zod';

/**
 * Field rules for the email/password auth forms in `widgets/`.
 *
 * These live in `@acme/ui` rather than `@acme/auth` on purpose: the forms are
 * presentational and prop-driven, so the package takes no dependency on the
 * auth seam and the slim apps' graph is unaffected (ADR 0010). The caller's
 * `onSubmit` receives the parsed credentials and owns the call to whatever
 * provider is wired up.
 *
 * The schemas are handed to TanStack Form as Standard Schema validators, so
 * zod stays the single source of the messages — no resolver package, and no
 * second copy of the rules.
 */

/** Password floor, mirrored in the sign-up hint text. */
export const MIN_PASSWORD_LENGTH = 8;

export const signInSchema = z.object({
  email: z.email('Enter a valid email address'),
  password: z.string().min(1, 'Enter your password'),
});

export type SignInCredentials = z.infer<typeof signInSchema>;

/** What the caller's `onSubmit` receives — confirmation is a form-only field. */
export const signUpSchema = z.object({
  name: z.string().trim().min(1, 'Enter your name'),
  email: z.email('Enter a valid email address'),
  password: z
    .string()
    .min(
      MIN_PASSWORD_LENGTH,
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
    ),
});

export type SignUpCredentials = z.infer<typeof signUpSchema>;

/** Adds the confirmation field the form renders but never hands on. */
export const signUpFormSchema = signUpSchema
  .extend({ confirmPassword: z.string() })
  .refine((values) => values.password === values.confirmPassword, {
    error: 'Passwords do not match',
    path: ['confirmPassword'],
  });

/**
 * The message a field renders, read off TanStack Form's `meta.errors`.
 *
 * That array is typed as the union of every validator slot the field could
 * carry, so it is narrowed structurally here rather than asserted: a Standard
 * Schema validator contributes issue objects with a `message`, a plain function
 * validator contributes a bare string. Anything else counts as "no message"
 * rather than rendering `[object Object]` at the user.
 */
export function firstErrorMessage(errors: readonly unknown[]) {
  for (const error of errors) {
    if (typeof error === 'string') {
      return error;
    }

    if (typeof error === 'object' && error !== null && 'message' in error) {
      const { message } = error;

      if (typeof message === 'string') {
        return message;
      }
    }
  }
}

/**
 * The prop shape both auth forms share. The caller owns the provider call, so
 * it also owns the outcome: `error` renders until the caller clears it — reset
 * it when a fresh attempt starts, or the previous rejection stays on screen.
 */
export interface AuthFormProps<Credentials> {
  /**
   * Called with validated credentials. The form never talks to a provider, so
   * `@acme/ui` needs no `@acme/auth` dependency (ADR 0010).
   */
  onSubmit: (credentials: Credentials) => void;
  /** A rejected attempt, rendered above the submit control. Caller-cleared. */
  error?: string | null;
  /** Submission in flight: the submit control disables and shows progress. */
  pending?: boolean;
  className?: string;
}
