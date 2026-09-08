/**
 * What a package declares it needs to run, validated against what exists.
 *
 * `acme.infra` is how a package names the local services it touches; an app's
 * required infra is the union of that field over its transitive closure, and
 * nothing is assumed on (ADR 0009). The field had no validator anywhere, so a
 * typo was accepted in silence and produced a compose profile matching no
 * service — the failure mode being "the container you needed never started".
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
      const entry = /^\s+-\s+(.+?)\s*$/.exec(item);
      if (!entry?.[1]) break; // the next key ends the sequence
      profiles.add(entry[1].replace(/^["']|["']$/g, ''));
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
