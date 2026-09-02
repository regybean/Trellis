# Mounting `@acme/logger`

Nothing to mount. Import the logger and call it. Every other package in the
graph logs through this one, so an app gets it whether or not it imports it
itself.

## What it gives you

- One structured logger, shared by your app and every package it mounts, so
  output from a feature and output from your own code interleave in one format.
- A module-level instance, so nothing has to be threaded through a context or
  passed down a call chain.

## Surface

| Import         | What's in it        | Runs   |
| -------------- | ------------------- | ------ |
| `@acme/logger` | The `logger` object | either |

## Wiring

- None. `import { logger } from '@acme/logger'` and call it.
- To send output somewhere else, replace this package. The instance is created
  at module scope with no options seam, which is deliberate: a sink is a
  deployment-wide decision, not something each app configures.
