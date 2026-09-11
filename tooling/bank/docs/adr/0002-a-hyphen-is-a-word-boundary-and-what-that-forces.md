# A hyphen is a word boundary, and the two exemptions that forces

**Status:** accepted

`check-bank-tokens` asks whether distributable content names this repo — its
owner, its name, its apps. It spent its whole life reporting zero while fifteen
distributable lines named the repo, because the pattern treated `-` as a word
character:

```
(?<![\w-])trellis(?![\w-])
```

Every compound built out of a name therefore matched nothing. `trellis-postgres`,
`dev-nextjs.log`, `trellis-tanstack-start` — a hyphen on either side and the name
was invisible. The same blind spot sat in `check-portable`'s rule 4, which exists
specifically to stop a root ADR naming an app, and which was at that moment
passing a root ADR that spelled out all four of this repo's apps in exactly that
form. A gate reporting zero looks identical to a clean repo, which is why this
went unnoticed through a report-only period and a sweep made in its name.

**A compound built out of a name still names it.** That is why the name is in
there. So the boundary is now `(?<!\w)…(?!\w)` in both checkers, and `/` is a
boundary too — `apps/<app>` is the plainest way there is to name an app.

## Why the widening needs exemptions at all

Two compounds are legitimate, and both would otherwise fail the gate. Neither is
a special case for a particular string: each is a general statement about who
chose the name.

### An upstream package specifier

`@t3-oss/env-nextjs` is that package's name. A consumer who installs it gets the
same string whatever their apps are called, and renaming an app changes nothing
about it. So a token inside `@scope/name` is exempt **when the scope is not one
this workspace publishes under**. The scope test is what separates it from
`@acme/<app>`, which is precisely the thing a consumer will not have.

Deriving the scopes from the workspace rather than listing them means a repo that
renames its scope needs no edit here.

### A default the consumer can override from the environment

`INFRA_CONTAINER_PREFIX="${INFRA_CONTAINER_PREFIX:-trellis-}"` names this repo,
and that is fine. The name is a _fallback_: a consumer exports the variable once
and every container follows. The content is portable in the way that actually
matters — it runs correctly in their repo without an edit, and the thing they
would change is already a named knob rather than a string to find and replace.

So the value in `${VAR:-value}` (and the `-` / `:=` spellings) is exempt. A bare
literal gets nothing, because there is nothing for the consumer to set. That
distinction is the whole rule: **naming this repo is acceptable exactly when the
name is overridable.**

This is what took `deploy/compose.yaml` from six pinned `container_name:
trellis-*` entries to six interpolations of the same variable the log follower
already read. The two halves had drifted — the follower's prefix was a variable
and the compose file's was not — and the ADR describing that mechanism said the
prefix "cannot be derived". Making the gate able to see the literal is what
surfaced it.

## Both exemptions are positions, not verdicts

They are character ranges on a line, checked against where each match landed, not
a decision about the line as a whole. A line can carry an upstream package _and_
this repo's name, and the second one is still reported. A line-level exemption
would have been simpler and would have silently swallowed the case it is least
safe to miss.

## Implemented twice, on purpose

`tooling/bank` and `tooling/repo-checks` each carry their own copy. Neither can
import the other: the bank's checkers run before `pnpm install` resolves anything
([0001-the-bank-keeps-its-own-workspace-helpers.md](0001-the-bank-keeps-its-own-workspace-helpers.md)),
and `repo-checks` has to keep working in a consumer repo that has no bank at all.
A future reader will find the duplication and try to remove it; the removal
passes every gate here and breaks both callers.

## Considered and rejected

- **Keep the hyphen inside the word and add the missed spellings by hand.**
  Rejected — that is an allowlist of the compounds somebody happened to think of,
  and the next one is silent again. The false negative was structural.
- **Exempt whole files that are known to contain a prefix.** Rejected — the
  always-included bundle is exactly where a leak matters most, and file-level
  exemption is how a file stops being read at all.
- **Allow any hyphenated compound whose full form is a declared dependency.**
  Rejected as the general rule: the case that motivated it, `@t3-oss/env-nextjs`,
  is discussed in an ADR without being installed anywhere, so the dependency
  manifest would not have covered it. The scope test does, and needs no lookup.
- **Ban the repo name outright, with no environment exemption.** Rejected. It
  would force a derived default — from the directory name, say — which is a
  worse failure: the prefix silently differs between two clones of the same repo
  and the log follower matches nothing, reported as a silent service.
