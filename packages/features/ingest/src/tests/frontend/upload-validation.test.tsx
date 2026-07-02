import { describe, expect, it } from 'vitest';

import {
  MAX_FILE_SIZE_BYTES,
  validateFiles,
} from '../../lib/upload-validation';

// A File whose reported size we can control without allocating bytes.
const fileOf = (name: string, size = 1, type = '') => {
  const file = new File(['x'], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
};

describe('validateFiles', () => {
  it('accepts supported extensions under the size limit', () => {
    expect(
      validateFiles([fileOf('a.pdf'), fileOf('b.docx'), fileOf('c.txt')]),
    ).toEqual([]);
  });

  it('is case-insensitive on the extension', () => {
    expect(validateFiles([fileOf('SHOUT.PDF')])).toEqual([]);
  });

  it('rejects unsupported extensions', () => {
    expect(validateFiles([fileOf('malware.exe')])).toEqual([
      'Unsupported file format: malware.exe',
    ]);
  });

  it('rejects files over the size limit', () => {
    expect(validateFiles([fileOf('big.pdf', MAX_FILE_SIZE_BYTES + 1)])).toEqual([
      'File too large (max 50MB): big.pdf',
    ]);
  });

  it('accepts a file exactly at the size limit', () => {
    expect(validateFiles([fileOf('edge.pdf', MAX_FILE_SIZE_BYTES)])).toEqual([]);
  });

  it('reports one error per rejected file and skips valid ones', () => {
    expect(
      validateFiles([
        fileOf('ok.txt'),
        fileOf('bad.exe'),
        fileOf('big.pdf', MAX_FILE_SIZE_BYTES + 1),
      ]),
    ).toEqual([
      'Unsupported file format: bad.exe',
      'File too large (max 50MB): big.pdf',
    ]);
  });

  it('flags a file that is both unsupported and too large twice', () => {
    expect(
      validateFiles([fileOf('huge.exe', MAX_FILE_SIZE_BYTES + 1)]),
    ).toEqual([
      'Unsupported file format: huge.exe',
      'File too large (max 50MB): huge.exe',
    ]);
  });
});
