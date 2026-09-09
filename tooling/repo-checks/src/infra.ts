/**
 * What a package declares it needs to run, validated against what exists.
 *
 * `acme.infra` is how a package names the local services it touches; an app's
 * required infra is the union of that field over its transitive closure, and
 * nothing is assumed on (ADR 0009). The field had no validator anywhere, so a
 * typo was accepted in silence and produced a compose profile matching no
 * service — the failure mode being "the container you needed never started".
 * `acme.provisioning` and `acme.seeds`, which the same resolver discovers
 * beside it, fail in the same silence and are validated here too.
 *
 * The profiles are read from the compose file rather than listed here, for the
 * same reason the workspace directories are read from `pnpm-workspace.yaml`: a
 * second copy of the answer is a second thing to drift.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/** Where the local dev stack is defined. */
export const COMPOSE_FILE = 'deploy/compose.yaml';

/**
 * Every profile named in a compose file, sorted and de-duplicated.
 *
 * A line scanner, as with `parseWorkspaceGlobs`: `profiles:` is a flat sequence
 * of strings under a service, so reading it needs no YAML dependency — and this
 * runs inside `pnpm lint` immediately after install, where a dependency with a
 * build step would not be there yet.
 */
export function composeProfiles(raw: string): string[] {
  const profiles = new Set<string>();
  const lines = raw.split('\n');

  for (const [index, line] of lines.entries()) {
    if (!/^\s*profiles:\s*$/.test(line)) continue;
    for (const item of lines.slice(index + 1)) {
      if (/^\s*(#.*)?$/.test(item)) continue; // blank line or comment
      // Trailing space is trimmed rather than matched: a `(.+?)\s*$` tail and
      // the `\s` before it can both claim the same run of spaces, which is
      // polynomial backtracking on a line that turns out not to match.
      const entry = /^\s+-\s+(.+)$/.exec(item);
      if (!entry?.[1]) break; // the next key ends the sequence
      profiles.add(entry[1].trim().replace(/^["']|["']$/g, ''));
    }
  }

  return [...profiles].sort();
}

/**
 * The profiles this repo's compose file defines, or `undefined` when it ships
 * none — a workspace with no local stack has nothing to validate against, and
 * failing every `acme.infra` entry there would be wrong.
 */
export function composeProfilesAt(root: string): string[] | undefined {
  const file = path.join(root, COMPOSE_FILE);
  return existsSync(file)
    ? composeProfiles(readFileSync(file, 'utf8'))
    : undefined;
}

/** What is wrong with one package's `acme.infra`, as a list of messages. */
export function validateInfra(
  name: string,
  acme: Readonly<Record<string, unknown>> | undefined,
  profiles: readonly string[],
): string[] {
  const infra = acme?.infra;
  if (infra === undefined) return []; // declaring nothing starts nothing

  if (!Array.isArray(infra)) {
    return [
      `${name}: "acme.infra" must be an array of ${COMPOSE_FILE} profile names`,
    ];
  }

  const errors: string[] = [];
  for (const entry of infra) {
    if (typeof entry !== 'string') {
      errors.push(
        `${name}: "acme.infra" entry \`${JSON.stringify(entry)}\` is not a profile name`,
      );
    } else if (!profiles.includes(entry)) {
      errors.push(
        `${name}: "acme.infra" names \`${entry}\`, which is not a profile in ${COMPOSE_FILE} (one of: ${profiles.join(', ')}) — a profile that matches no service starts nothing`,
      );
    }
  }
  return errors;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** `./src/provisioning.ts` and `src/provisioning.ts` name the same file. */
const withoutDot = (rel: string) => rel.replace(/^\.\//, '');

/**
 * What is wrong with one package's provisioning declarations — the two keys
 * `pnpm dev` and `pnpm infra:up` discover beside `acme.infra`
 * ([ADR 0009](../../../docs/adr/0009-graph-derived-dev-infra.md)).
 *
 * Both fail the same way `acme.infra` did before it had a validator: in
 * silence. A `provisioning` path that names no file is only found when someone
 * runs `pnpm dev`, and a `seeds` entry naming a profile nothing defines is
 * never found at all — discovery merges seeds onto the profiles a closure
 * declares, so a misspelled one is dropped and the seed just never runs.
 *
 * The declaration's *contents* are not this rule's business: the module is code
 * that has to be loaded to be read, and `@acme/workspace-graph` validates the
 * shape it gets when it loads one.
 */
export function validateProvisioning(
  name: string,
  acme: Readonly<Record<string, unknown>> | undefined,
  profiles: readonly string[],
  scripts: readonly string[],
  files: readonly string[],
): string[] {
  const errors: string[] = [];

  const module = acme?.provisioning;
  if (module !== undefined) {
    if (typeof module !== 'string') {
      errors.push(
        `${name}: "acme.provisioning" must be a path to a module exporting PROVISIONING`,
      );
    } else if (!files.includes(withoutDot(module))) {
      errors.push(
        `${name}: "acme.provisioning" names \`${module}\`, which is not a file in the package — discovery would fail on it`,
      );
    }
  }

  const seeds = acme?.seeds;
  if (seeds === undefined) return errors;
  if (!isRecord(seeds)) {
    errors.push(
      `${name}: "acme.seeds" must map a ${COMPOSE_FILE} profile name to a script this package declares`,
    );
    return errors;
  }

  for (const [profile, script] of Object.entries(seeds)) {
    if (!profiles.includes(profile)) {
      errors.push(
        `${name}: "acme.seeds" names \`${profile}\`, which is not a profile in ${COMPOSE_FILE} (one of: ${profiles.join(', ')}) — a seed for a profile nothing declares never runs`,
      );
    }
    if (typeof script !== 'string') {
      errors.push(
        `${name}: "acme.seeds.${profile}" is not the name of a script`,
      );
    } else if (!scripts.includes(script)) {
      errors.push(
        `${name}: "acme.seeds.${profile}" names the script \`${script}\`, which this package does not declare`,
      );
    }
  }

  return errors;
}
