import { convert } from 'officeparser';

// Plain-text files need no parsing; office formats (.pdf/.docx/.xlsx/.pptx) go
// through officeparser, which auto-detects the format from the buffer.
export async function extractText(file: File) {
  const buffer = Buffer.from(await file.arrayBuffer());

  if (file.name.toLowerCase().endsWith('.txt')) {
    return buffer.toString('utf8');
  }

  const { value } = await convert(buffer, 'text');
  if (typeof value !== 'string') {
    throw new TypeError(`Expected text output parsing ${file.name}`);
  }
  return value;
}
