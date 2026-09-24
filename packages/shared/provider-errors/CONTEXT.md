# Provider errors (`@acme/provider-errors`)

Turns any thrown provider value into a **Failure reason** and whether retrying
can help. One pure function, a closed vocabulary and a default message per
reason. It resolves nothing, calls nothing and imports no provider SDK — the
package that selects providers is `@acme/models`, and this one only reads what
they throw.

## Language

**Failure reason**:
The closed set of eight strings any provider failure reduces to: `overloaded`,
`rate_limited`, `too_long`, `unavailable`, `content_filtered`, `auth`,
`invalid_request`, `unknown`. Closed is the point — dashboards, alerting, copy
and retry logic all key off the same vocabulary, so a newly observed failure is
a row in the decision table rather than a ninth member. _Avoid_: "error code",
"error type" (both name a provider's own string, which is an input here).

**Retryable**:
Whether trying the same request again can succeed, derived from the reason every
time it is asked for. `overloaded`, `rate_limited` and `unavailable` are;
the rest are not. It is never stored, never travels on a wire and is not an
input, so it cannot disagree with the reason it came from. _Avoid_: "transient"
as a field name (it reads like a stored property).

**Unknown**:
The explicit bucket for a failure nothing recognised — a reason like the other
seven, not an absence. It exists so that adding a provider does not require
enumerating its error space first, and so that classification never has to guess
or throw. _Avoid_: "other", "unclassified".

**Normalized failure**:
The flat record every decision reads: the messages found, the codes found, a
status where one exists, the provider body's nested metadata, and the SDK's own
retryable flag. Produced by one function that owns every shape-specific detail —
which wrapper hid the real error, which of six field names carried the status.
_Avoid_: "the error object" (the whole point is that there is no single one).

**Override**:
A mapping that contradicts the status-derived reading and wins over it: an
upstream-model 424 that is retryable though the SDK's formula calls it
permanent; a local out-of-memory 500 that is permanent though every retry layer
will retry it; a payment-required answer that is a wait rather than a dead end
when one nested metadata value says so; a local provider that is not running and
carries no status at all. Overrides sit above the status table, which is what
"wins" means in code. _Avoid_: "special case", "exception".

**Default message**:
The user-facing string a reason carries when a caller has nothing better to say.
None names a provider, a model, an HTTP status, or repeats a provider's own
error text. `auth` and `invalid_request` deliberately share one string — both
are operator faults and neither is the user's to fix — while staying separate
reasons so logs and alerting can still tell them apart. _Avoid_: "error
message" (that is the provider's, and it is the thing never shown).

## Relationships

- **Classification is duck-typed, never `instanceof`.** Error shapes are not a
  stable contract across providers or SDK majors, so every probe is structural
  and the package depends on no provider SDK — only zod, for the reason schema
  that a wire event can be typed off.
- **Unwrapping comes before every decision.** A retryable failure that exhausts
  the SDK's retries is re-thrown wrapped with the real error nested inside, so
  most retryable failures arrive that way; a classifier reading the wrapper sees
  a generic message, no status, and reports `unknown`.
- **Input normalization is isolated behind one function** in its own file,
  because it holds the volatile knowledge. The next AI SDK major collapses the
  mid-stream error into one shape, and that upgrade should delete a branch there
  rather than edit the decision table.
- **`@acme/ingest` is the first consumer.** Its job-completion notification
  names the cause rather than only counting failures, which is what tells a user
  whether to re-upload or wait.

## Decisions

See [`docs/adr/`](docs/adr/).
