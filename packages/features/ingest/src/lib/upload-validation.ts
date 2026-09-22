// Pure, framework-agnostic validation for Document uploads. Kept out of the
// hook/component so it is trivially unit-testable (no React, no tRPC).

export const ACCEPTED_EXTENSIONS = ['.pdf', '.docx', '.txt'] as const;
export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50MB

/** Return one human-readable error per rejected file; empty array = all valid. */
export function validateFiles(files: readonly File[]): string[] {
  const errors: string[] = [];
  const accepted: readonly string[] = ACCEPTED_EXTENSIONS;
  for (const file of files) {
    const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
    if (!accepted.includes(ext)) {
      errors.push(`Unsupported file format: ${file.name}`);
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      errors.push(`File too large (max 50MB): ${file.name}`);
    }
  }
  return errors;
}

/**
 * Two picks are one batch. The native control replaces its `files` whole on
 * every pick, so appending is the dialog's job — a second trip to the picker
 * to add one more file used to throw away everything chosen on the first.
 *
 * Identity is name + size + lastModified because `File` has no id and the same
 * file re-picked is a new object: picking it twice should leave one row, and
 * two same-named files from different folders should leave two.
 */
export function appendFiles(current: readonly File[], picked: readonly File[]) {
  const seen = new Set(current.map((file) => fileKey(file)));
  const added = picked.filter((file) => !seen.has(fileKey(file)));
  return [...current, ...added];
}

/** A `File`'s identity within one batch. */
export function fileKey(file: File) {
  return `${file.name}:${file.size}:${file.lastModified}`;
}
