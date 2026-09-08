/**
 * Reading the manifest blocks these rules police.
 *
 * A manifest arrives unnarrowed — the rules that read it are its validators
 * (`@acme/workspace-graph`) — so the narrowing happens once, here, rather than
 * in each rule that wants the `acme` block or the list of script names. The
 * *values* stay unknown on the way out: whether `acme.testStatus` is even a
 * string is a rule's finding, not something to quietly drop on the floor.
 */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The `acme` block, or `undefined` when the manifest declares none usable. */
export function acmeBlock(
  manifest: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> | undefined {
  return isRecord(manifest.acme) ? manifest.acme : undefined;
}

/** The names of the scripts a manifest declares with a command. */
export function scriptNames(
  manifest: Readonly<Record<string, unknown>>,
): string[] {
  if (!isRecord(manifest.scripts)) return [];
  return Object.entries(manifest.scripts)
    .filter(([, command]) => typeof command === 'string' && command !== '')
    .map(([name]) => name);
}
