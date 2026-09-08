/**
 * The env composition, diff and merge that `pnpm env:pull` / `pnpm env:push`
 * run on — as a module rather than as `node -e` strings inside two shell
 * scripts.
 *
 * The shell keeps what only shell can do: the backend dispatch, the adapter
 * contract (`scripts/secrets-backends/<name>.sh`, a published extension point)
 * and the interactive prompts. Everything it used to express as an inline
 * one-liner lives here, reachable from `src/cli.ts`.
 */
export type { EnvRecord } from './dotenv';
export { parseEnvFile, serializeEnv } from './dotenv';
export { isSecretKey, secretKeys } from './classify';
export type { SensitivePayload } from './compose';
export { composeDesired, sensitiveOnly } from './compose';
export type { EnvDiff, MergeOptions, ValueConflict } from './merge';
export { diff, merge } from './merge';
export { renderConflicts, renderKeyList } from './report';
