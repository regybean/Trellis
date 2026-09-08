/**
 * Comparing and combining two sides of the sync.
 *
 * Both directions have the same shape once you name the sides by role rather
 * than by location: a **source** the values are coming from and a
 * **destination** they are going to. Pull reads the vault into a file, so the
 * vault is the source; push reads a file into the vault, so the file is. That
 * naming is the whole reason this is one function instead of two — the shell
 * had two copies of it, and they had already drifted.
 */
import type { EnvRecord } from './dotenv';

/** A key both sides hold, with different values. */
export interface ValueConflict {
  key: string;
  source: string;
  destination: string;
}

/** What comparing the two sides turned up. */
export interface EnvDiff {
  /** Keys only the destination holds — the ones an overwrite would drop. */
  destinationOnly: string[];
  /** Keys both sides hold with different values. */
  differing: ValueConflict[];
}

/**
 * Compare the two sides. Absence and emptiness are different things here:
 * a key held by both sides with an empty value on each is *identical*, so it is
 * reported nowhere.
 *
 * The shell asked this question as `e['KEY'] || ''` on each side, which read an
 * absent key and an empty one as the same empty string. That made a key whose
 * value is legitimately empty — every unfilled secret in an example — report as
 * differing on every single run, forever.
 */
export function diff({
  source,
  destination,
}: {
  source: EnvRecord;
  destination: EnvRecord;
}): EnvDiff {
  const destinationOnly = Object.keys(destination).filter(
    (key) => !(key in source),
  );
  const differing: ValueConflict[] = [];
  for (const [key, value] of Object.entries(source)) {
    if (!(key in destination)) continue;
    const current = destination[key];
    if (current !== undefined && current !== value) {
      differing.push({ key, source: value, destination: current });
    }
  }
  return { destinationOnly, differing };
}

/** How to resolve what the diff turned up. Both answers come from a prompt. */
export interface MergeOptions {
  source: EnvRecord;
  destination: EnvRecord;
  /** Keep the destination's own keys rather than dropping them. */
  keepExtra: boolean;
  /** For keys both sides hold, take the source's value over the destination's. */
  preferSource: boolean;
}

/**
 * Combine the two sides into what the destination should become.
 *
 * Three outcomes, matching what the shell did:
 *
 * - **Keep the destination's values** (`preferSource: false`) — the destination
 *   stands as it is, and only genuinely new source keys are appended. Its own
 *   keys survive whatever `keepExtra` says, because keeping the destination's
 *   values and deleting its keys is not a coherent instruction; the shell
 *   resolved it the same way.
 * - **Take the source, keep the extras** (`preferSource`, `keepExtra`) — source
 *   order first, then the destination-only keys.
 * - **Take the source** — the source, and nothing else.
 */
export function merge({
  source,
  destination,
  keepExtra,
  preferSource,
}: MergeOptions): EnvRecord {
  if (!preferSource) {
    const merged: EnvRecord = { ...destination };
    for (const [key, value] of Object.entries(source)) {
      if (!(key in destination)) merged[key] = value;
    }
    return merged;
  }
  if (!keepExtra) return { ...source };
  const merged: EnvRecord = { ...source };
  for (const [key, value] of Object.entries(destination)) {
    if (!(key in source)) merged[key] = value;
  }
  return merged;
}
