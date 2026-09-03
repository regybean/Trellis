# Recipe: the env composition

Each package declares its whole environment in one `createEnv` call in its own
`env.ts`, exported from its `./env` subpath
([@acme/env ADR 0001](../../packages/platform/env/docs/adr/0001-one-env-factory-per-slice.md)). Your app composes those
factories into one call. That call is your app's only sanctioned `process.env`
edge.

## 1. Compose the factories you mount

```ts
export const env = createEnv({
  clientPrefix: "NEXT_PUBLIC_",
  extends: [chatEnv(), ingestEnv()],
  server: {
    /* keys only your app owns */
  },
  client: {},
  createFinalSchema: (shape) => withProfiles(shape, appEnv, { default: {} }),
  runtimeEnv: {
    /* your own keys, written longhand */
  },
});
```

Mount a package, add its factory. Each factory validates its own keys at boot,
so a missing value fails at startup with the name of the key rather than at the
first request that needs it.

## 2. Config and secret

Within a package's `createEnv` call the distinction is mechanical:

- a key the resolved profile supplies a value for is **config**;
- a key it does not is a **secret**, and your deployment must provide it.

Every `ADAPTER.md` **Env** table uses that rule. Config keys need nothing from
you to run locally, and every one of them is still overridable by an environment
variable of the same name, so retuning one on a live deploy needs no rebuild.

A key that is config in development and a secret on a real target shows as
`config → secret`: the development profile authors a local stand-in and the
staging and production overlays remove it.

## 3. Don't pass `skipValidation`

`createEnv` returns `runtimeEnv` before merging `extends`, so a skipped
composition edge evaluates to an empty object rather than to unvalidated values.
Profiles relax per key instead, which keeps config defaults working during lint
and build runs.

## 4. Keys your app owns, not a package

Anything a shared package cannot know belongs in your composition call: the
origin your app is served from, the port it listens on, the service name it
reports. A package that needs one takes it as a parameter instead of reading it,
which is why some `ADAPTER.md` **Wiring** sections ask you to pass a value in.

## 5. Client reads

The access guard is name-based: it consults the `shared` and `client` dicts of
the call doing the reading. Your composition call declares none of a package's
keys itself, so **client-side reads import the owning package's `./env`
directly** and server-side reads come through your composed object.

## 6. Selector keys

A key your bundler has to inline textually — the deploy-target selector, the app
identity, anything read in client code — must be written longhand as
`process.env.KEY` in `runtimeEnv`. An index access is invisible to a bundler's
find-and-replace, so it inlines nothing and the value is undefined in the
browser.
