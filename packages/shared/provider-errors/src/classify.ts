import type { FailureReason } from './failure-reason';
import type { NormalizedFailure } from './normalize';
import { isRetryable } from './failure-reason';
import { normalizeFailure } from './normalize';

/**
 * The decision table. Everything below is a lookup on the normalized record —
 * no shape knowledge, no unwrapping, no provider SDK imported. A newly
 * observed failure is a row added here, never a ninth `FailureReason`.
 *
 * Rules run in order and the first answer wins, so the order encodes priority:
 * the overrides that contradict the status-derived reading sit above the status
 * table, and the SDK's own retryable flag sits at the bottom where it can only
 * break a tie that nothing else broke.
 */

/** Socket-level codes, which mean the request never reached a provider. */
const NETWORK_CODES: ReadonlySet<string> = new Set([
  'econnrefused',
  'econnreset',
  'enotfound',
  'ehostunreach',
  'enetunreach',
  'etimedout',
  'epipe',
  // The same conditions under a runtime that names them differently.
  'connectionrefused',
  'connectionclosed',
  'failedtoopensocket',
]);

const UNREACHABLE_TEXT =
  /cannot connect to api|fetch failed|failed to fetch|connection refused|socket hang up/;

/**
 * A local model server declining to load a model that does not fit in the
 * host's memory. It answers 500, so every retry layer in the stack will retry
 * it forever, and it will fail identically every time until someone changes
 * the machine or the model.
 */
const OUT_OF_MEMORY_TEXT = 'requires more system memory';

/**
 * The one nested metadata value that turns a payment-required answer from a
 * dead end into a wait. The account is not out of credit; its in-flight spend
 * is momentarily reserved by requests still running, and the same request
 * succeeds once they settle.
 */
const IN_FLIGHT_BUDGET_TEXT = 'in_flight_budget';

const TOO_LONG_CODES: ReadonlySet<string> = new Set([
  'context_length_exceeded',
  'string_above_max_length',
  'max_tokens_exceeded',
]);

const TOO_LONG_TEXT =
  /context length|context window|maximum context|too many tokens|token limit|is too long|request too large/;

const FILTERED_CODES: ReadonlySet<string> = new Set([
  'content_filter',
  'content_policy_violation',
  'moderation',
]);

const FILTERED_TEXT =
  /content filter|content_filter|moderation|flagged|guardrail|blocked by|responsible ai/;

/**
 * Status → reason, grouped by reason so each one is named once.
 *
 * Two rows carry decisions that the status alone does not justify:
 *
 * - **424 is retryable.** One provider documents it as the upstream model
 *   erroring transiently and tells callers to retry with backoff, while the
 *   SDK's own formula (408, 409, 429, 5xx) marks it permanent. The provider's
 *   documentation wins.
 * - **409 is retryable**, matching that same SDK formula, because a conflict
 *   here is a concurrent-request artifact rather than a request defect.
 */
const STATUS_TABLE: readonly (readonly [FailureReason, readonly number[]])[] = [
  ['invalid_request', [400, 404, 405, 422]],
  ['auth', [401, 402, 403]],
  ['too_long', [413]],
  ['rate_limited', [429]],
  ['unavailable', [408, 409, 424, 500, 502, 504]],
  ['overloaded', [503, 529]],
];

/**
 * Message patterns, for the failures that carry no usable status: an SDK
 * error subclass raised before any request went out, a provider that describes
 * the problem only in prose.
 */
const TEXT_TABLE: readonly (readonly [FailureReason, RegExp])[] = [
  ['rate_limited', /rate limit|too many requests|throttl|quota exceeded/],
  ['overloaded', /overloaded|at capacity|server is busy|is not ready/],
  [
    'auth',
    /api key|unauthorized|authentication|credential|access denied|accessdenied|not authorized|expired token|invalid signature/,
  ],
  [
    'invalid_request',
    /invalid (request|prompt|parameter|argument|value)|validation|unsupported|no such model|model not found/,
  ],
  ['unavailable', /timed out|timeout|unavailable|unreachable|service is down/],
];

type Rule = (failure: NormalizedFailure) => FailureReason | undefined;

/**
 * A local provider that is not running produces no status at all, so the
 * status table can never see it. Without this rule every developer whose model
 * server is stopped reads `unknown` and goes looking for a bug in the app.
 */
const unreachable: Rule = ({ status, codes, text }) => {
  if (status !== undefined) return;
  const refused = codes.some((code) => NETWORK_CODES.has(code));
  if (refused || UNREACHABLE_TEXT.test(text)) return 'unavailable';
};

/** Permanent for this host, whatever the 500 and the retry flag claim. */
const outOfMemory: Rule = ({ text }) => {
  if (text.includes(OUT_OF_MEMORY_TEXT)) return 'invalid_request';
};

/** Payment required, but the transient kind. */
const inFlightBudget: Rule = ({ status, metadata }) => {
  if (status !== 402) return;
  const signals = [metadata.limit_source, metadata.reason].filter(
    (signal) => typeof signal === 'string',
  );
  const throttled = signals.some((signal) =>
    signal.includes(IN_FLIGHT_BUDGET_TEXT),
  );
  if (throttled) return 'rate_limited';
};

/**
 * Ahead of the status table because the same status carries both readings: a
 * context overflow is a 400 on one provider and a 200 with a finish reason on
 * another, and neither is a request our code got wrong.
 */
const tooLong: Rule = ({ codes, text }) => {
  const coded = codes.some((code) => TOO_LONG_CODES.has(code));
  if (coded || TOO_LONG_TEXT.test(text)) return 'too_long';
};

/**
 * Ahead of the status table because one provider serves a moderation block as
 * a 403, which the table reads — correctly, for every other provider — as a
 * credentials problem.
 */
const contentFiltered: Rule = ({ codes, text, metadata }) => {
  const coded = codes.some((code) => FILTERED_CODES.has(code));
  const flagged = metadata.flagged_input !== undefined;
  if (coded || flagged || FILTERED_TEXT.test(text)) return 'content_filtered';
};

const byStatus: Rule = ({ status }) => {
  if (status === undefined) return;
  for (const [reason, statuses] of STATUS_TABLE) {
    if (statuses.includes(status)) return reason;
  }
  // Anything else in the server range is the provider's problem, not ours,
  // including the gateway-minted 5xx codes a proxy invents.
  if (status >= 500) return 'unavailable';
};

const byText: Rule = ({ text }) => {
  if (text === '') return;
  for (const [reason, pattern] of TEXT_TABLE) {
    if (pattern.test(text)) return reason;
  }
};

/**
 * The tiebreaker, and the only thing the SDK's own flag is allowed to decide.
 * It runs last, on a failure nothing else recognised: a value we cannot name
 * but that the SDK says is worth retrying is closer to a transient outage than
 * to an unexplained one.
 */
const sdkTiebreak: Rule = ({ sdkRetryable }) =>
  sdkRetryable === true ? 'unavailable' : undefined;

const RULES: readonly Rule[] = [
  unreachable,
  outOfMemory,
  inFlightBudget,
  tooLong,
  contentFiltered,
  byStatus,
  byText,
  sdkTiebreak,
];

/**
 * Reduce any thrown provider value to a reason and whether retrying can help.
 *
 * Takes `unknown` and never throws: a surprising error shape must not turn a
 * handled failure into an unhandled one. Whatever it cannot recognise lands in
 * `unknown`, which is a bucket rather than a guess.
 *
 * `retryable` is derived from `reason` here and is not an input, so the two
 * cannot disagree and there is nothing for a caller to set, store or send.
 */
export function classifyProviderFailure(thrown: unknown) {
  const reason = reasonFor(thrown);
  return { reason, retryable: isRetryable(reason) };
}

function reasonFor(thrown: unknown): FailureReason {
  const failure = normalizeFailure(thrown);
  for (const rule of RULES) {
    const reason = rule(failure);
    if (reason !== undefined) return reason;
  }
  return 'unknown';
}
