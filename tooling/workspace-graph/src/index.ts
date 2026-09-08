/**
 * `@acme/workspace-graph` — the one reader of this repo's workspace.
 *
 * Every repo script needs some part of the same picture: which directories hold
 * packages, what those packages declare, which one a CLI token names, what a
 * package's closure contains and what that closure needs to run. Each script
 * used to answer it again, and the copies drifted. They live here instead, with
 * the CLI convention the checkers share.
 *
 * Consumed from source (no build step): nothing builds `tooling/*` at install
 * time, so a compile step would leave this broken for the `pnpm lint` that runs
 * immediately after `pnpm install`.
 */
export type { WorkspacePackage } from './workspace';
export {
  WORKSPACE_FILE,
  parseWorkspaceGlobs,
  readPackage,
  workspaceApps,
  workspaceDirs,
  workspacePackages,
  workspacePackagesIn,
} from './workspace';

export { matchToken, resolveToken } from './tokens';

export type { WorkspaceProject } from './closure';
export {
  closureInfra,
  closurePackages,
  declaredInfra,
  workspaceClosure,
} from './closure';

export type {
  ComposeEnvironmentInput,
  ModelRole,
  ModelsSelection,
  ProviderSelection,
  StripeConnection,
} from './provisioning';
export {
  composeEnvironment,
  portOf,
  pruneInfra,
  roleUsing,
} from './provisioning';

export type { Report, ReportOptions, Violations } from './cli';
export {
  collectViolations,
  formatReport,
  repoRoot,
  reportAndExit,
  resolveRoot,
} from './cli';
