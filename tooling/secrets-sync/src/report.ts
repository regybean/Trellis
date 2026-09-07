/**
 * Rendering a diff for a human to answer a prompt about.
 *
 * The shell owns the prompts, so it owns the question ("keep these?") and the
 * names of the two sides — it is the half that knows a file path and a secret
 * id. This module owns the block of text underneath, and hands it back ready to
 * print so the shell never has to take a JSON document apart.
 *
 * An empty block means there is nothing to ask about, which is why each block
 * is written to its own file: `[ -s "$file" ]` is the whole test.
 */

/** One key per line, as a bullet. Empty in, empty out. */
export function renderKeyList(keys: string[]): string {
  return keys.map((key) => `  - ${key}\n`).join('');
}

/** A conflicting key and its two values, already assigned to their captions. */
export interface ConflictRow {
  key: string;
  left: string;
  right: string;
}

/**
 * Each conflicting key with both values under it. The captions are the caller's
 * because "local" and "remote" swap sides between pull and push, and the reader
 * cares which file it is, not which argument it was.
 */
export function renderConflicts(
  rows: ConflictRow[],
  captions: { left: string; right: string },
): string {
  const width = Math.max(captions.left.length, captions.right.length) + 2;
  const caption = (text: string) => `${text}:`.padEnd(width);
  return rows
    .map(
      (row) =>
        `  ${row.key}\n` +
        `    ${caption(captions.left)}${row.left}\n` +
        `    ${caption(captions.right)}${row.right}\n`,
    )
    .join('');
}
