# A deploy target authors its own profile, or the slice refuses to boot

**Status:** accepted

> Amends [ADR 0001](0001-one-env-factory-per-slice.md) §2, which made a target
> with no overlay inherit the development base, and its rejected alternative
> "requiring every non-development target to author an overlay". That record
> stays where it is: it is the reasoning this one argues against.

## Context

[ADR 0001](0001-one-env-factory-per-slice.md) §2 said a target with no
overlay of its own inherits the base, and gave
a reason: §4 makes every key environment-overridable, so a deploy target's values
arrive as environment variables and a slice does not have to be re-authored to be
deployable. The rejected-alternatives list called the opposite rule "right when
the environment is not an authoring surface; wrong here".

A repo consuming this one found out how it fails. A production deploy inherited
the base and came up with its identity provider's issuer on a localhost port and
its upstream API host on another. Every schema validated. Every value was
present. Every first request was wrong. The failure survives a health check and
looks like a working deploy, because nothing is missing — the wrong thing is
there.

The reasoning was one step short. Environment-overridability is what makes the
base _survivable_, not what makes it _correct_: it means a target **can** be
fixed from outside, not that anyone remembered to. The development base is not a
neutral fallback, it is a set of localhost literals, and inheriting it is a
deploy-shaped answer to a question nobody asked.

This repo has no deployed configuration of its own yet, which is the only
reason the rule has not bitten here.

## Decision

**A target other than `development` must author its own overlay. A real boot
that finds one missing raises, naming the target.** `development` is unchanged —
it _is_ the base.

### The rule is wholesale, not a heuristic

Every deploy target, every slice, staging held to the same rule as production. A
narrower variant was considered: raise only when an inherited value _looks like_
a loopback address. It catches the reported incident at about a third of the
cost, but it is a guess about the shape of a wrong value, and a
non-loopback-but-wrong inherited value still slips through. A half-authored
staging is the same failure wearing a different name.

### An empty overlay satisfies the rule

The check is for the overlay's **presence**, and `{}` is present. Be honest
about what that buys: the rule compels an explicit act of authorship, not
correct values. Someone can still write `production: {}` without thinking. What
they cannot do is never be asked.

That is also what makes the rule affordable. Most slices in this repo author
runtime modes, cache lifetimes, poll intervals and limits — nothing in them
could be wrong on a deploy target, and demanding invented values from them would
be the rule making things up. An empty overlay is their signature, and it is a
deliberate one: **it is not dead config, and a reader who deletes it will find
out at the next deploy's boot.**

An exemption flag on the slice was considered and rejected. A flag is the kind of
thing that gets copied from a neighbouring slice without being read, which is the
failure mode the rule exists to catch.

### The localhost class unauthors rather than invents

A key whose base value is genuinely a localhost address sets itself to
`undefined` in the deploy overlay.
[ADR 0001](0001-one-env-factory-per-slice.md) already has this mechanism:
unauthoring makes the key a **secret** on that target by the same mechanical
rule as every other secret, so a deploy that forgets to inject it crashes at
boot naming the key.

So the overlay states something true — _this target must supply this_ — rather
than a hostname belonging to a cluster that may not exist. No commented-out
example is needed, and no fiction enters a repo that has nothing deployed.
Target-neutral siblings stay authored: a database's port is not an address.

### The all-secrets helper supplies both deploy overlays itself

`secretsOnly(appEnv)` is `withProfiles` over empty profiles, for a shape whose
every key is a credential. Under this rule an empty `default` alone would raise
on every deploy target for a shape where a profile has nothing it could say.

It supplies `staging: {}` and `production: {}` rather than being exempted. Its
contract is already a complete statement about all three targets — no key here
carries an authored value anywhere — so writing them out expresses the existing
meaning instead of carving a hole in the rule.

### The raise respects `shouldSkipEnvValidation()`

This is a deliberate divergence from the consumer repo's implementation, which
raises ahead of any skip logic.

That predicate is true for the lint step, for the Next production build, and for
non-test CI. Without this carve-out the rule would fire on a target-neutral
slice during a lint run or an image build that carried `APP_ENV=staging` — and
both apps' Dockerfiles set exactly that, long before anything is deployed. A run
that cannot supply a secret cannot supply a deploy target's config either. **A
build is not a boot.**

The cost is stated rather than hidden: a CI step with `APP_ENV` set will not
catch an unauthored profile. The boot will, which is where the incident
happened.

## Consequences

- **A deploy that would have come up on loopback now fails to come up.** That is
  the whole point: a crash naming `staging` is cheaper than a deploy serving
  every request against the wrong host.
- **Adding a slice means answering the question.** A new slice that authors no
  deploy overlay boots in development and raises the first time anyone selects a
  target, so the question of _what is this key on a deploy target_ is asked
  before a deploy asks it.
- **Adding a key to an existing slice puts the question in front of you**, since
  the target profiles are already there to add it to.
- **The overlays stay optional in the `Profiles` type.** The rule is about a
  boot, not a compile: making them required would fail an app on every slice in
  its graph at once, rather than on the one it mounts, and would lose the message
  naming the target. It also means a subset app pays nothing for slices it never
  resolves.
- **An app is held to the rule exactly as a slice is**, because an app's env
  composition layers profiles through the same call.
- **The provisioning readers are unaffected.** The testcontainer descriptors and
  the compose resolver import a slice's development profile module directly
  ([ADR 0001](0001-one-env-factory-per-slice.md) §6), so they read the authored
  base and never reach an overlay.
- **This is now a standing divergence from the consumer repo** on the skip path,
  and that repo has its own unauthored slices that would raise under its own
  rule. Documented here so the difference is a decision rather than a discovery.
