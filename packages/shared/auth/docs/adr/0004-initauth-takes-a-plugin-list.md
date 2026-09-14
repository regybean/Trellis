# `initAuth` takes a plugin list, not a provider config object

**Status:** accepted

> **Amends [ADR 0001](0001-self-hosted-better-auth.md).** That decision left a
> social provider out of scope and called it "purely additive later". This is the
> answer to that open question — the mechanism by which a provider gets added,
> decided once, so the next one costs nothing. Self-hosting, sessions as rows and
> the slice-owned secret are all unchanged.

`initAuth` opens two of its decisions to the caller and keeps the rest closed.

```ts
initAuth({ baseUrl, trustedOrigins, plugins, emailAndPassword });
```

`plugins` **appends** to the built-ins; `emailAndPassword: false` registers no
password routes. Everything else stays where it was: the Drizzle adapter over the
dedicated `auth` schema, the slice-owned secret, the explicit no-cookie-cache
session policy, the unconditional `admin()` plugin, and `better-auth/minimal` as
the entry. A caller that passes neither new option gets exactly the instance it
had before, which is why both are optional and neither app changed.

## Why a plugin list

The obvious alternative was a **provider config object** — `initAuth` would take
`{ oidc: { issuer, clientId, … } }` and construct the plugin itself, keeping
Better Auth's plugin import paths out of the consumer's import graph. That was
the leading candidate until it met the library.

In Better Auth 1.7.2 the generic OAuth plugin **contributes no endpoints of its
own**: providers are driven through the core social sign-in and OAuth callback
endpoints. So the case that motivated the change never needed
plugin-contributed types at the call site, and hiding an import was the config
object's only remaining argument. Against it, a config object still has to map
to a plugin tuple the type system can see, which means hand-maintaining a
conditional type — cognitive load in the seam, paid by this package forever, to
save the consumer one import line. Rejected.

A list also keeps the seam honest about its own limits. Whatever Better Auth
ships, and whatever a consumer writes, goes through the same door; this package
learns nothing about any particular provider, which is the property that makes
the consumer's provider config and token exchange **their** files rather than a
fork of ours.

## Why generic, and why optional

The worry was that making `initAuth` generic would reintroduce **TS2742**. The
Better Auth `Auth` type sits outside the library's `exports` map, which is the
only reason `initAuth` carries an explicit return type at all, so a generic
return type was the kind of change that fails at declaration emit rather than at
`tsc --noEmit`. It was prototyped rather than reasoned about. Three shapes were
compiled with declarations on:

| Variant                                               | Declarations emit | Added plugin's endpoints typed | Existing call shape unchanged |
| ----------------------------------------------------- | ----------------- | ------------------------------ | ----------------------------- |
| Non-generic, plugins widened to the base plugin type  | no TS2742         | erased                         | yes                           |
| Generic, plugins required                             | no TS2742         | yes                            | no, breaks callers            |
| Generic, plugins optional with an empty-tuple default | no TS2742         | yes                            | yes                           |

The third is the decision. Two details in it are load-bearing, each established
by a variant that failed:

- **The tuple is spread into the array literal** (`[admin(), ...(plugins ?? [])]`),
  not concatenated. The spread is what produces a tuple type rather than a widened
  `BetterAuthPlugin[]`, and the widening is what erased the endpoints in the first
  row above.
- **The optional parameter is not resolved through a fallback that unions in a
  second array type at the value level.** That widening erases the plugin types
  just as surely, while still compiling.

The `const` type-parameter modifier is part of the configuration that passed.
Whether it is load-bearing on its own was not isolated, so it stays.

Because the guarantee is a type, it is guarded by a type — `src/tests/backend/plugin-types.probe.ts`
is compiled by the `build` task, which emits declarations, and asserts that an
appended plugin's endpoint is present on the instance that asked for it and
**absent** on the one that did not. A runtime suite cannot see either fact.

## Why the credential provider is a boolean

`emailAndPassword` sets Better Auth's `enabled` flag rather than dropping the
key. Omitting the key would change the options object's type, and therefore the
inferred instance and session types — a much larger change than the one being
asked for, and not one any caller requested. `enabled: false` registers no
password routes, which is the behaviour, and leaves the type shape identical.

## Why `admin()` stays unconditional

It backs the user-management widgets, and `role`/`banned`/`banReason`/`banExpires`
are already columns in the shared schema
([ADR 0002](0002-auth-tables-in-a-dedicated-schema.md)). An instance without the
plugin would be running against a schema describing a plugin it does not have.

## What this does not do

It makes a provider possible; it does not ship one. No app here gains a provider,
no provider-specific code or credential lands in this package, and no new env key
is demanded. A consumer running an identity provider owns exactly two files — its
provider's configuration and whatever token exchange its estate needs — and takes
the rest of this package unmodified.
