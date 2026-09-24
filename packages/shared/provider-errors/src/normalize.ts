/**
 * Input normalization: everything shape-specific about a thrown provider value
 * lives here, so the classifier reads one flat record and nothing else.
 *
 * This file is deliberately the only place that knows how the current AI SDK
 * major wraps and nests a failure. Those shapes are the volatile part — the
 * next major normalizes the mid-stream error into a single shape — and that
 * upgrade should delete a branch here rather than edit the decision table in
 * `classify.ts`.
 *
 * Nothing here decides anything. It never throws, and on a value it cannot
 * read at all it returns an empty record, which the classifier reads as
 * `unknown`.
 */

/** Everything the classifier reads, lifted out of whatever was thrown. */
export interface NormalizedFailure {
  /**
   * Every message string found, joined and lower-cased. A haystack for the
   * pattern rules and never shown to anyone — it carries the provider's own
   * wording, which is exactly what user-facing copy must not repeat.
   */
  readonly text: string;
  /**
   * Every non-numeric code found, lower-cased: a provider's own error code
   * (`context_length_exceeded`) and the socket codes off the cause chain
   * (`econnrefused`) land in the same list, because both are identifiers
   * rather than prose and the rules match them the same way.
   */
  readonly codes: readonly string[];
  /** An HTTP-ish status, if any of the field names below carried one. */
  readonly status?: number;
  /** A provider error body's `metadata` — nested detail some rules turn on. */
  readonly metadata: Readonly<Record<string, unknown>>;
  /** The SDK's own retryable flag. The tiebreaker of last resort, nothing more. */
  readonly sdkRetryable?: boolean;
}

const EMPTY: NormalizedFailure = { text: '', codes: [], metadata: {} };

/** How far to follow a wrapper or a `cause` chain before giving up. */
const UNWRAP_LIMIT = 8;

/**
 * Anything with string keys. Deliberately a hand-written guard rather than a
 * zod record parse: the values arriving here are class instances, and
 * `Error.message` is a non-enumerable own property that a record schema would
 * silently drop.
 */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A non-empty string, or nothing. Every probe below reads through this. */
const asText = (value: unknown) =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

function asRecord(value: unknown) {
  return isRecord(value) ? value : undefined;
}

/**
 * Peel wrappers until the real failure is on top.
 *
 * The retry wrapper comes first and matters most: with this SDK major, a
 * retryable failure that exhausts its retries is re-thrown wrapped, with the
 * original nested inside. Three of the eight reasons essentially always arrive
 * that way, so a classifier that reads the wrapper reads a generic message and
 * no status, and reports `unknown` for the failures that happen most.
 */
function unwrapOnce(value: unknown): unknown {
  const record = asRecord(value);
  if (record === undefined) return;

  // The retry wrapper: named, and carrying the attempts it made. Matched
  // structurally as well as by name, because the name is a vendor string while
  // the shape is what actually identifies it.
  const attempts: unknown[] | undefined = Array.isArray(record.errors)
    ? record.errors
    : undefined;
  if (record.name === 'AI_RetryError' || attempts !== undefined) {
    const last = record.lastError ?? attempts?.at(-1);
    if (last !== undefined && last !== null) return last;
  }

  // A mid-stream error chunk, which is a carrier rather than a failure. The
  // next SDK major collapses this shape, at which point this branch goes.
  if (record.type === 'error' && record.error !== undefined)
    return record.error;
}

function unwrap(thrown: unknown) {
  let current = thrown;
  for (let step = 0; step < UNWRAP_LIMIT; step += 1) {
    const next = unwrapOnce(current);
    if (next === undefined) break;
    current = next;
  }
  return current;
}

/** Each record on the `cause` chain, nearest first. */
function causeChain(root: Record<string, unknown>) {
  const chain: Record<string, unknown>[] = [];
  let current = asRecord(root.cause);
  for (let depth = 0; depth < UNWRAP_LIMIT && current !== undefined; depth++) {
    chain.push(current);
    current = asRecord(current.cause);
  }
  return chain;
}

/**
 * The provider's own error body, wherever the SDK parked it. `data` is the
 * parsed body on an API error; `error` is the body itself when the raw value
 * was thrown or read off a stream.
 */
function nestedError(root: Record<string, unknown>) {
  const parsed = asRecord(root.data);
  if (parsed !== undefined) {
    const body = asRecord(parsed.error);
    return body ?? parsed;
  }
  return asRecord(root.error);
}

/** A provider error body's `metadata`, which several rules turn on. */
function nestedMetadata(nested: Record<string, unknown> | undefined) {
  if (nested === undefined) return {};
  return asRecord(nested.metadata) ?? {};
}

/** A status field's value as a plausible HTTP status, or nothing. */
function asStatus(value: unknown) {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value >= 100 && value <= 599 ? value : undefined;
  }
  if (typeof value !== 'string' || value.trim() === '') return;
  const numeric = Number(value);
  if (!Number.isInteger(numeric)) return;
  return numeric >= 100 && numeric <= 599 ? numeric : undefined;
}

/**
 * A status, from the six field names the providers and the SDK use between
 * them. First readable one wins, so the order is the priority order.
 *
 * The nested body code leads deliberately. One provider cannot change the HTTP
 * status once a stream has been committed, so it answers 200 and puts the real
 * code in the body — switching on the transport status alone reads that
 * failure as a success.
 *
 * Non-numerics are rejected rather than coerced, which is what keeps a string
 * code like `context_length_exceeded` out of here and in `codes` where it
 * belongs. Plenty of failures carry no status at all: a refused connection, a
 * validation error raised before a request ever went out.
 */
function readStatus(
  root: Record<string, unknown>,
  nested: Record<string, unknown> | undefined,
) {
  const awsMetadata = asRecord(root.$metadata);
  const candidates = [
    nested?.code, // the provider error body's own code
    root.statusCode, // the SDK's API error
    root.status, // a response-shaped error
    root.status_code, // the newline-delimited native client
    awsMetadata?.httpStatusCode, // an AWS service error
    root.originalStatusCode, // the upstream status a gateway exception relays
  ];

  for (const candidate of candidates) {
    const status = asStatus(candidate);
    if (status !== undefined) return status;
  }
}

function compact(parts: (string | undefined)[]) {
  return parts.flatMap((part) => (part === undefined ? [] : [part]));
}

function readText(
  root: Record<string, unknown>,
  nested: Record<string, unknown> | undefined,
) {
  const metadata = nestedMetadata(nested);
  const parts = compact([
    asText(root.message),
    asText(root.error),
    asText(nested?.message),
    asText(metadata.raw),
    asText(root.responseBody),
    ...causeChain(root).map((link) => asText(link.message)),
  ]);
  return parts.join(' | ').toLowerCase();
}

function readCodes(
  root: Record<string, unknown>,
  nested: Record<string, unknown> | undefined,
) {
  const metadata = nestedMetadata(nested);
  const parts = compact([
    asText(root.code),
    asText(root.type),
    asText(nested?.code),
    asText(nested?.type),
    asText(metadata.error_type),
    asText(metadata.provider_code),
    ...causeChain(root).map((link) => asText(link.code)),
  ]);
  return parts.map((part) => part.toLowerCase());
}

export function normalizeFailure(thrown: unknown): NormalizedFailure {
  const root = unwrap(thrown);

  // A thrown bare string carries no shape at all, so it is guarded here rather
  // than left to fall through every probe below as a non-record.
  if (typeof root === 'string') {
    return { ...EMPTY, text: root.toLowerCase() };
  }

  const record = asRecord(root);
  if (record === undefined) return EMPTY;

  const nested = nestedError(record);
  return {
    text: readText(record, nested),
    codes: readCodes(record, nested),
    status: readStatus(record, nested),
    metadata: nestedMetadata(nested),
    sdkRetryable:
      typeof record.isRetryable === 'boolean' ? record.isRetryable : undefined,
  };
}
