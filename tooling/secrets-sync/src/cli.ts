/**
 * The command line the shell scripts drive.
 *
 * `scripts/env-pull.sh` and `scripts/env-push.sh` keep the preamble, the
 * `SECRETS_BACKEND` dispatch, the adapters and the prompts; every decision they
 * used to make in an inline `node -e` string is one of the commands below.
 *
 * Each direction is two steps with the prompt in between:
 *
 *   plan-pull    → write the "here is what differs" blocks the prompts print
 *   apply-pull   → the resulting .env, on stdout, for the shell to install
 *
 *   payload-push → the sensitive-only JSON a push may send, on stdout
 *   plan-push    → the same blocks, for the same prompts
 *   apply-push   → the JSON to hand the backend adapter, on stdout
 *
 * Files rather than stdin for the inputs, because both plans need two documents
 * and neither should travel in argv, where `ps` can read it.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import type { EnvRecord } from './dotenv';
import { composeDesired, sensitiveOnly } from './compose';
import { parseEnvFile, serializeEnv } from './dotenv';
import { diff, merge } from './merge';
import { renderConflicts, renderKeyList } from './report';

const USAGE = `Usage: secrets-sync <command> [options]

  plan-pull    --example <f> --env <f> --vault <f> --extras-out <f> --differing-out <f>
  apply-pull   --example <f> --env <f> --vault <f> [--keep-extra] [--prefer-source]
  payload-push --example <f> --env <f>
  plan-push    --local <f> --remote <f> --extras-out <f> --differing-out <f>
  apply-push   --local <f> --remote <f> [--keep-extra] [--prefer-source]
`;

/** An operator's mistake — reported as a message, never a stack trace. */
class UsageError extends Error {}

type Options = Record<string, string | boolean | undefined>;

/** A dotenv file that need not exist yet — an unfilled `.env` is not an error. */
function readEnv(path: string): EnvRecord {
  return existsSync(path) ? parseEnvFile(readFileSync(path, 'utf8')) : {};
}

/**
 * A vault payload. An adapter prints `{}` for a secret that does not exist yet
 * and nothing at all for one it could not read, so both mean "nothing there".
 * Values are coerced, because a vault holds JSON and a key may hold a number.
 */
function readVault(path: string): EnvRecord {
  const raw = existsSync(path) ? readFileSync(path, 'utf8').trim() : '';
  if (!raw) return {};
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new UsageError(`${path} is not a JSON object`);
  }
  const env: EnvRecord = {};
  for (const [key, value] of Object.entries(parsed)) {
    env[key] = typeof value === 'string' ? value : String(value);
  }
  return env;
}

function required(options: Options, name: string): string {
  const value = options[name];
  if (typeof value !== 'string') throw new UsageError(`--${name} is required`);
  return value;
}

/**
 * The environment a `.env` should hold. Without an example there is nothing to
 * classify against, so the vault is taken wholesale — the same fallback the
 * shell had, warning included.
 */
function desiredEnv(examplePath: string, vaultPath: string): EnvRecord {
  const vault = readVault(vaultPath);
  if (!existsSync(examplePath)) {
    process.stderr.write(
      `⚠️  No ${examplePath} found; using vault values only.\n`,
    );
    return vault;
  }
  return composeDesired({
    example: parseEnvFile(readFileSync(examplePath, 'utf8')),
    vault,
  });
}

/**
 * The sensitive-only payload, or a hard stop: with no example nothing can be
 * classified, and pushing an unclassified file is how config reaches a vault.
 */
function pushPayload(examplePath: string, envPath: string): EnvRecord {
  if (!existsSync(examplePath)) {
    throw new UsageError(
      `${examplePath} is required to classify which keys are secret`,
    );
  }
  const { payload, undeclared } = sensitiveOnly({
    example: parseEnvFile(readFileSync(examplePath, 'utf8')),
    local: readEnv(envPath),
  });
  for (const key of undeclared) {
    process.stderr.write(
      `⚠️  ${key} is set in ${envPath} but not declared in ${examplePath} — skipping (not pushed)\n`,
    );
  }
  return payload;
}

/**
 * Write the two prompt blocks. Each is its own file so the shell can ask
 * `[ -s ... ]` instead of parsing anything; an empty file means no prompt.
 *
 * `local` names whichever side the human is looking at from the repo — the
 * source when pushing, the destination when pulling — so the captions read the
 * same way in both directions.
 */
function writePlan(
  options: Options,
  sides: {
    source: EnvRecord;
    destination: EnvRecord;
    localSide: 'source' | 'destination';
  },
) {
  const { destinationOnly, differing } = diff(sides);
  const rows = differing.map((conflict) =>
    sides.localSide === 'source'
      ? {
          key: conflict.key,
          left: conflict.source,
          right: conflict.destination,
        }
      : {
          key: conflict.key,
          left: conflict.destination,
          right: conflict.source,
        },
  );
  writeFileSync(
    required(options, 'extras-out'),
    renderKeyList(destinationOnly),
  );
  writeFileSync(
    required(options, 'differing-out'),
    renderConflicts(rows, { left: 'Local', right: 'Remote' }),
  );
}

function run(argv: string[]) {
  const [command] = argv;
  if (!command) throw new UsageError(USAGE);

  const { values } = parseArgs({
    args: argv.slice(1),
    options: {
      example: { type: 'string' },
      env: { type: 'string' },
      vault: { type: 'string' },
      local: { type: 'string' },
      remote: { type: 'string' },
      'extras-out': { type: 'string' },
      'differing-out': { type: 'string' },
      'keep-extra': { type: 'boolean', default: false },
      'prefer-source': { type: 'boolean', default: false },
    },
  });

  const resolution = {
    keepExtra: values['keep-extra'] === true,
    preferSource: values['prefer-source'] === true,
  };

  switch (command) {
    // Pull: the vault-backed environment is the source, the .env the destination.
    case 'plan-pull':
      writePlan(values, {
        source: desiredEnv(
          required(values, 'example'),
          required(values, 'vault'),
        ),
        destination: readEnv(required(values, 'env')),
        localSide: 'destination',
      });
      return;
    case 'apply-pull':
      process.stdout.write(
        serializeEnv(
          merge({
            source: desiredEnv(
              required(values, 'example'),
              required(values, 'vault'),
            ),
            destination: readEnv(required(values, 'env')),
            ...resolution,
          }),
        ),
      );
      return;
    // Push: the local file is the source, the vault the destination.
    case 'payload-push':
      process.stdout.write(
        `${JSON.stringify(pushPayload(required(values, 'example'), required(values, 'env')), null, 2)}\n`,
      );
      return;
    case 'plan-push':
      writePlan(values, {
        source: readVault(required(values, 'local')),
        destination: readVault(required(values, 'remote')),
        localSide: 'source',
      });
      return;
    case 'apply-push':
      process.stdout.write(
        `${JSON.stringify(
          merge({
            source: readVault(required(values, 'local')),
            destination: readVault(required(values, 'remote')),
            ...resolution,
          }),
        )}\n`,
      );
      return;
    default:
      throw new UsageError(`Unknown command '${command}'\n\n${USAGE}`);
  }
}

try {
  run(process.argv.slice(2));
} catch (error) {
  process.stderr.write(
    `${error instanceof UsageError ? error.message : String(error)}\n`,
  );
  process.exit(1);
}
