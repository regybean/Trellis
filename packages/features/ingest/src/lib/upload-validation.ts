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
