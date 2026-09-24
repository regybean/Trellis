# Interpreting a provider failure is its own package

**Status:** accepted

Interpreting what a model provider threw is a separate shared-layer package
from selecting and constructing providers. `@acme/models` resolves a provider;
`@acme/provider-errors` reads what one throws and says what happened. Nothing
else in the repo interprets a provider failure, so this package is the only
place that knowledge lives.

## Why the split, given both are provider knowledge

Folding the classifier into `@acme/models` was the obvious move and is the one
rejected here.

Resolution and interpretation are different jobs with different shapes.
Resolution is configuration: it reads authored env, constructs model instances
eagerly at import, and fails fast when a selected provider has no credentials.
Interpretation is a pure function over a value that arrives at runtime, from a
provider that may not even be the selected one — a gateway relays an upstream
error, and the shape belongs to whoever produced it.

Widening the resolver to carry both is also hard to reverse. Three consumers
depend on the classifier, and each would reach `@acme/models` through it,
pulling eager provider construction and a credentials check into graphs that
only wanted to name a failure. The classifier depends on nothing but zod
precisely so that a UI, a worker or a schema barrel can read it.

The split has a real cost, and it is stated rather than hidden: provider
knowledge now lives in two shared packages, one that selects providers and one
that interprets their failures. Adding a provider means touching both. That is
accepted because the two touches are different in kind — a selection variant on
one side, a table row on the other — and neither needs the other to be correct.

## What the package is allowed to do

**One pure function over `unknown`, which never throws.** A surprising error
shape must not turn a handled failure into an unhandled one. Whatever is not
recognised lands in `unknown`, which is a reason like the other seven.

**A closed vocabulary of eight reasons.** Dashboards, alerting, retry logic and
user-facing copy all key off the same strings. A newly observed failure is a row
added to the decision table; it is not a ninth reason. The union closes so that
every consumer can be exhaustive over it.

**`retryable` derived, never stored.** It is computed from the reason on every
read, is not an input, and does not travel on a wire. Two values that can
disagree eventually will, and this pair cannot.

**No provider SDK as a dependency.** Every probe is structural. Error shapes are
not a stable contract across providers or SDK majors, and an `instanceof` check
against a class the caller may have installed twice is a false negative waiting
to happen.

**No provider name, model id, HTTP status or provider error text in a
user-facing message.** The full failure belongs in the logs, where the detail is
useful; the user gets the reason, in their own terms.

## The decisions inside the classifier that are not obvious

**Unwrapping runs before anything decides.** With the installed AI SDK major, a
retryable failure that exhausts its retries is re-thrown wrapped, with the real
error nested inside — so three of the eight reasons essentially always arrive
that way. A classifier that reads the wrapper reads a generic message and no
status, and reports `unknown` for the failures that happen most.

**Input normalization is isolated in its own file**, and nothing else knows a
wrapper shape. The next AI SDK major collapses the mid-stream error into a
single shape, and that upgrade should delete a branch there rather than edit the
decision table.

**Four mappings override the status-derived reading**, each because the obvious
reading is wrong: an upstream-model 424 that its provider documents as retryable
though the SDK's own formula marks it permanent; a local provider's
out-of-memory 500 that every retry layer will retry forever and that is
permanent for that host; a payment-required answer that is a wait rather than a
dead end when one nested metadata value says the in-flight spend budget is
momentarily full; and a local provider that is not running, which produces no
status at all and is recognised from the refused connection instead.

**The SDK's own retryable flag is a tiebreaker and nothing else.** It is read
last, on a failure nothing else recognised, where it promotes `unknown` to
`unavailable`. Reading it earlier would let a vendor's retry heuristic overrule
the four overrides, which exist because that heuristic is wrong about them.

## Consequences

- Chat, retrieval and ingest describe the same outage the same way, because
  there is one table rather than three.
- A consumer selecting this package takes zod and nothing else.
- A provider that changes its error shape breaks a test fixture in this package
  rather than a feature in production, because the fixtures are the captured
  shapes.
- Adding a provider means a selection variant in the resolver and, separately,
  whatever rows its error space needs here. Neither change is blocked on the
  other.
