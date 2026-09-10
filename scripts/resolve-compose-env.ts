// Every value `compose.yaml` interpolates to provision the local infra stack,
// printed as `KEY=value` lines. `scripts/compose.sh` runs this and exports the
// lines into the environment, where compose substitutes the `${...}` refs at
// parse time.
//
// The values are DISCOVERED, not listed: `@acme/workspace-graph` walks the
// closure of every app, asks each package what it supplies for the infra
// profiles that closure declares (`acme.provisioning`), and merges the answers.
// So this file names no package and no value, a slice that adds infra needs no
// change here, and a checkout that took none of these packages prints nothing
// instead of failing on an import.
//
// What each package supplies stays the AUTHORED development value and never an
// operator's override — reading one here would be circular, since `compose.sh`
// exports this output back into the environment. Keeping that rule is the
// declaring package's job; it is the one reading its own profile, from a module
// that runs no `createEnv` call.
//
// Run via `pnpm exec tsx`: plain node can't load the workspace TS config graph
// (its relative imports are extensionless), and the provisioning modules
// discovery loads are TypeScript for the same reason.
import {
  closureProvisioning,
  composeEnvironment,
  repoRoot,
  workspaceApps,
} from "../tooling/workspace-graph/src/index";

const root = repoRoot();

// Discovery loads each declaring package's module, so the answer is a promise.
// Wrapped rather than awaited at the top level because the root package is CJS
// (no `"type": "module"`), which esbuild refuses to emit top-level await into. A
// rejection is left unhandled deliberately: node prints it and exits non-zero,
// so `compose.sh` fails instead of exporting a half-resolved stack.
void (async () => {
  const environment = composeEnvironment(
    await closureProvisioning(
      root,
      workspaceApps(root).map((app) => app.name),
    ),
  );

  process.stdout.write(
    [
      ...Object.entries(environment).map(([key, value]) => `${key}=${value}`),
      "",
    ].join("\n"),
  );
})();
