import { describe, expect, it } from 'vitest';

import type { FailureReason } from '../../../failure-reason';
import { classifyProviderFailure } from '../../../classify';
import {
  FAILURE_MESSAGES,
  failureMessage,
  failureReasonSchema,
  isRetryable,
} from '../../../failure-reason';

/**
 * Table-driven over captured failure shapes. Pure: no container, no network,
 * no provider SDK — the package depends on none, and neither does this.
 *
 * The fixtures below are hand-built rather than imported from a provider
 * because the shapes are the thing under test. Building them here means the
 * suite states what arrives on the wire, and a provider that changes shape
 * breaks a fixture a reader can see instead of a transitive type.
 */

/** The SDK's own retryable formula, reproduced so the overrides mean something. */
const sdkRetryable = (statusCode?: number) =>
  statusCode !== undefined &&
  (statusCode === 408 ||
    statusCode === 409 ||
    statusCode === 429 ||
    statusCode >= 500);

interface ApiCallErrorInit {
  message: string;
  statusCode?: number;
  data?: unknown;
  responseBody?: string;
  cause?: unknown;
  isRetryable?: boolean;
}

/**
 * The SDK's API error: a real `Error`, so `message` is a non-enumerable own
 * property, with the transport fields assigned as enumerable ones.
 */
function apiCallError(init: ApiCallErrorInit) {
  const error =
    init.cause === undefined
      ? new Error(init.message)
      : new Error(init.message, { cause: init.cause });
  return Object.assign(error, {
    name: 'AI_APICallError',
    url: 'https://provider.example/v1/chat/completions',
    requestBodyValues: {},
    statusCode: init.statusCode,
    responseBody: init.responseBody,
    data: init.data,
    isRetryable: init.isRetryable ?? sdkRetryable(init.statusCode),
  });
}

/** The retry wrapper a retryable failure arrives in once its retries run out. */
function retryError(last: unknown) {
  const message =
    last instanceof Error
      ? `Failed after 3 attempts. Last error: ${last.message}`
      : 'Failed after 3 attempts.';
  return Object.assign(new Error(message), {
    name: 'AI_RetryError',
    reason: 'maxRetriesExceeded',
    errors: [last, last, last],
    lastError: last,
  });
}

/** A refused socket, as node's fetch reports it before the SDK wraps it. */
function connectionRefused() {
  const socket = Object.assign(
    new Error('connect ECONNREFUSED 127.0.0.1:11434'),
    {
      code: 'ECONNREFUSED',
      syscall: 'connect',
      port: 11_434,
    },
  );
  return apiCallError({
    message: 'Cannot connect to API: fetch failed',
    cause: socket,
    isRetryable: true,
  });
}

const alphabetical = (values: readonly string[]) =>
  values.toSorted((left, right) => left.localeCompare(right));

interface Case {
  readonly name: string;
  readonly thrown: unknown;
  readonly reason: FailureReason;
}

const CASES: readonly Case[] = [
  // --- the retry wrapper, which is how most retryable failures arrive ---
  {
    name: 'a retry-wrapped overload decides on the nested cause, not the wrapper',
    thrown: retryError(
      apiCallError({ message: 'Service Unavailable', statusCode: 503 }),
    ),
    reason: 'overloaded',
  },
  {
    name: 'a retry wrapper with no lastError falls back to its last attempt',
    thrown: Object.assign(new Error('Failed after 3 attempts.'), {
      name: 'AI_RetryError',
      errors: [apiCallError({ message: 'Too Many Requests', statusCode: 429 })],
    }),
    reason: 'rate_limited',
  },

  // --- the four documented overrides ---
  {
    name: 'override: a 424 from the upstream-model exception is retryable',
    thrown: apiCallError({
      message: 'The request failed due to an error while processing the model.',
      statusCode: 424,
      data: { message: 'ModelErrorException' },
    }),
    reason: 'unavailable',
  },
  {
    name: 'override: a local out-of-memory 500 is permanent for this host',
    thrown: apiCallError({
      message:
        'model requires more system memory (17.9 GiB) than is available (4.3 GiB)',
      statusCode: 500,
      data: {
        error: {
          message:
            'model requires more system memory (17.9 GiB) than is available (4.3 GiB)',
        },
      },
    }),
    reason: 'invalid_request',
  },
  {
    name: 'override: a 402 held up by an in-flight spend budget is a wait',
    thrown: apiCallError({
      message: 'Insufficient credits',
      statusCode: 402,
      data: {
        error: {
          code: 402,
          message: 'Insufficient credits',
          metadata: { limit_source: 'openrouter_in_flight_budget' },
        },
      },
    }),
    reason: 'rate_limited',
  },
  {
    name: 'override: a local provider that is not running carries no status',
    thrown: connectionRefused(),
    reason: 'unavailable',
  },

  // --- the readings the overrides are overriding ---
  {
    name: 'a plain 402 is an account problem, so it stays permanent',
    thrown: apiCallError({
      message: 'Insufficient credits',
      statusCode: 402,
      data: { error: { code: 402, message: 'Insufficient credits' } },
    }),
    reason: 'auth',
  },
  {
    name: 'a 500 with nothing else to go on is a transient outage',
    thrown: apiCallError({
      message: 'Internal Server Error',
      statusCode: 500,
    }),
    reason: 'unavailable',
  },

  // --- the hardcoded-200 body, where the real code is nested ---
  {
    name: 'a 200 carrying an error body is read from the nested code',
    thrown: {
      id: 'gen-abc123',
      object: 'chat.completion.chunk',
      error: {
        code: 502,
        message: 'Provider returned an invalid response',
        metadata: { provider_name: 'a-provider' },
      },
      choices: [{ finish_reason: 'error' }],
    },
    reason: 'unavailable',
  },

  // --- the other five status field names ---
  {
    name: 'the newline-delimited native client names its status differently',
    thrown: Object.assign(new Error('model "missing" not found'), {
      name: 'ResponseError',
      error: 'model "missing" not found',
      status_code: 404,
    }),
    reason: 'invalid_request',
  },
  {
    name: 'an AWS service error carries its status under $metadata',
    thrown: Object.assign(new Error('Model is not ready for inference'), {
      name: 'ModelNotReadyException',
      $metadata: { httpStatusCode: 429, requestId: 'req-1' },
    }),
    reason: 'rate_limited',
  },
  {
    name: 'a response-shaped error carries a bare status',
    thrown: { status: 401, message: 'The security token included is invalid' },
    reason: 'auth',
  },
  {
    name: 'a string status is coerced',
    thrown: { statusCode: '429', message: 'slow down' },
    reason: 'rate_limited',
  },
  {
    name: 'a non-numeric code is not a status, and lands in the codes instead',
    thrown: apiCallError({
      message: 'This model’s maximum context length is 8192 tokens',
      statusCode: 400,
      data: {
        error: {
          message: 'This model’s maximum context length is 8192 tokens',
          type: 'invalid_request_error',
          code: 'context_length_exceeded',
        },
      },
    }),
    reason: 'too_long',
  },

  // --- reasons that only a nested value or the prose can reach ---
  {
    name: 'a moderation block served as a 403 is not a credentials problem',
    thrown: apiCallError({
      message: 'Input flagged by moderation',
      statusCode: 403,
      data: {
        error: {
          code: 403,
          message: 'Input flagged by moderation',
          metadata: {
            reasons: ['violence'],
            flagged_input: 'redacted',
            provider_name: 'a-provider',
          },
        },
      },
    }),
    reason: 'content_filtered',
  },
  {
    name: 'a denied credential served as a 403 still is one',
    thrown: Object.assign(
      new Error('User is not authorized to perform bedrock:InvokeModel'),
      { name: 'AccessDeniedException', $metadata: { httpStatusCode: 403 } },
    ),
    reason: 'auth',
  },
  {
    name: 'a missing key raised before any request went out has no status',
    thrown: Object.assign(
      new Error('API key is missing. Pass it using the apiKey parameter.'),
      { name: 'AI_LoadAPIKeyError' },
    ),
    reason: 'auth',
  },
  {
    name: 'a rejected prompt is a request we built wrong',
    thrown: Object.assign(
      new Error('Invalid prompt: messages must not be empty'),
      {
        name: 'AI_InvalidPromptError',
      },
    ),
    reason: 'invalid_request',
  },
  {
    name: 'a content filter named only in prose is still a content filter',
    thrown: apiCallError({
      message: 'The generated text was blocked by the content filter',
      statusCode: 200,
    }),
    reason: 'content_filtered',
  },

  // --- the tiebreaker, and the bucket ---
  {
    name: 'an unrecognised failure the SDK marks retryable is read as transient',
    thrown: apiCallError({
      message: 'the sky turned green',
      isRetryable: true,
    }),
    reason: 'unavailable',
  },
  {
    name: 'a bare thrown string lands in the bucket',
    thrown: 'something went sideways',
    reason: 'unknown',
  },
  {
    name: 'an anonymous record with no name and no status lands in the bucket',
    thrown: { detail: 'nothing recognisable here', attempt: 2 },
    reason: 'unknown',
  },
];

describe('classifyProviderFailure', () => {
  it.each(CASES)('$name', ({ thrown, reason }) => {
    expect(classifyProviderFailure(thrown)).toEqual({
      reason,
      retryable: isRetryable(reason),
    });
  });

  it('covers every reason in the union across the table', () => {
    const covered = new Set(CASES.map((one) => one.reason));
    expect(alphabetical([...covered])).toEqual(
      alphabetical(failureReasonSchema.options),
    );
  });
});

describe('classifyProviderFailure never throws', () => {
  const HOSTILE: readonly unknown[] = [
    undefined,
    null,
    0,
    Number.NaN,
    '',
    [],
    [1, 2, 3],
    Symbol('nope'),
    () => 'a function',
    new Map(),
    { error: null },
    { error: { code: {} } },
    { type: 'error' },
    { errors: [] },
    { statusCode: 'not-a-number' },
    { cause: { cause: { cause: 'deep' } } },
    Object.create(null),
  ];

  it.each(HOSTILE.map((thrown, index) => ({ index, thrown })))(
    'returns a reason for hostile input #$index',
    ({ thrown }) => {
      const { reason, retryable } = classifyProviderFailure(thrown);
      expect(failureReasonSchema.options).toContain(reason);
      expect(retryable).toBe(isRetryable(reason));
    },
  );

  it('survives a cause chain that points at itself', () => {
    const looping: Record<string, unknown> = { message: 'round and round' };
    looping.cause = looping;
    expect(classifyProviderFailure(looping).reason).toBe('unknown');
  });

  it('survives a wrapper chain that points at itself', () => {
    const looping: Record<string, unknown> = { name: 'AI_RetryError' };
    looping.lastError = looping;
    expect(classifyProviderFailure(looping).reason).toBe('unknown');
  });
});

describe('retryable is derived from the reason', () => {
  it('is retryable exactly for the three transient reasons', () => {
    const retryable = failureReasonSchema.options.filter((reason) =>
      isRetryable(reason),
    );
    expect(retryable).toEqual(['overloaded', 'rate_limited', 'unavailable']);
  });

  it('cannot be set by a caller: a retryable-flagged input still follows its reason', () => {
    const thrown = apiCallError({
      message: 'This model’s maximum context length is 8192 tokens',
      statusCode: 400,
      // The SDK flag says retry. The reason says the request will never fit.
      isRetryable: true,
    });
    expect(classifyProviderFailure(thrown)).toEqual({
      reason: 'too_long',
      retryable: false,
    });
  });
});

describe('default messages', () => {
  const MESSAGES = failureReasonSchema.options.map((reason) =>
    failureMessage(reason),
  );

  it('has one for every reason', () => {
    expect(alphabetical(Object.keys(FAILURE_MESSAGES))).toEqual(
      alphabetical(failureReasonSchema.options),
    );
    for (const message of MESSAGES) expect(message.length).toBeGreaterThan(0);
  });

  it('names no provider, no model and no status', () => {
    const banned =
      /ollama|bedrock|openrouter|anthropic|openai|aws|claude|gpt|llama|\b\d{3}\b/i;
    for (const message of MESSAGES) expect(message).not.toMatch(banned);
  });

  it('says the same thing for the two operator faults, which stay separate reasons', () => {
    expect(failureMessage('auth')).toBe(failureMessage('invalid_request'));
    expect(failureReasonSchema.options).toContain('auth');
    expect(failureReasonSchema.options).toContain('invalid_request');
  });
});
