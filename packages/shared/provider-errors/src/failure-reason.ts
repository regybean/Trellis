import { z } from 'zod';

/**
 * The closed vocabulary every provider failure reduces to.
 *
 * Closed is the point. Dashboards, alerting, retry logic and user-facing copy
 * all key off these eight strings, so a newly observed failure goes in the
 * classifier's lookup table rather than adding a ninth member here.
 *
 * `unknown` is the explicit bucket rather than an absence: adding a provider
 * must not require enumerating its error space first.
 */
export const failureReasonSchema = z.enum([
  'overloaded',
  'rate_limited',
  'too_long',
  'unavailable',
  'content_filtered',
  'auth',
  'invalid_request',
  'unknown',
]);

export type FailureReason = z.infer<typeof failureReasonSchema>;

/**
 * The reasons where trying the same request again can succeed.
 *
 * Held as a set of reasons rather than a field on a classification result:
 * `retryable` is derived here, every time it is asked for, so it is never
 * stored, never travels on a wire and can never disagree with the reason it
 * came from. A caller that only has a `reason` — one decoded off a stream, one
 * read out of a log — derives the same answer the classifier would.
 */
const RETRYABLE_REASONS: ReadonlySet<FailureReason> = new Set<FailureReason>([
  'overloaded',
  'rate_limited',
  'unavailable',
]);

export function isRetryable(reason: FailureReason) {
  return RETRYABLE_REASONS.has(reason);
}

/**
 * Operator-fault copy, shared by `auth` and `invalid_request`.
 *
 * Both are our bugs — an expired credential and a malformed request are the
 * same event to the person who hit them, and neither is theirs to fix. They
 * stay separate *reasons* so logs and alerting can tell a credential problem
 * from a request-shape problem; only the wording collapses.
 */
const OPERATOR_FAULT =
  'Something is misconfigured on our side, so this one is not yours to fix. It has been logged.';

/**
 * The default user-facing message per reason.
 *
 * No message names a provider, a model, an HTTP status or repeats a provider's
 * own error text. Each says what happened in the user's terms and what, if
 * anything, they can do next — which is the only thing the distinction between
 * these reasons buys them.
 *
 * A caller is free to write its own copy for a reason it wants to say
 * differently; this is the default, not a mandate.
 */
export const FAILURE_MESSAGES: Readonly<Record<FailureReason, string>> = {
  overloaded: 'The service is busy right now. Try again in a moment.',
  rate_limited:
    'Too many requests just went through. Wait a moment, then try again.',
  too_long: 'This was too long to process. Try again with less content.',
  unavailable: 'The service could not be reached. Try again in a moment.',
  content_filtered: 'This request was blocked before it ran. Try rewording it.',
  auth: OPERATOR_FAULT,
  invalid_request: OPERATOR_FAULT,
  unknown: 'Something went wrong. Try again.',
};

export function failureMessage(reason: FailureReason) {
  // The key is a member of a closed union, not caller-supplied text, so the
  // lookup cannot reach a prototype member or a key the table does not hold.
  // eslint-disable-next-line security/detect-object-injection
  return FAILURE_MESSAGES[reason];
}
