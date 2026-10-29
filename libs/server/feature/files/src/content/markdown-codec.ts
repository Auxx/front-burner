import type { LineEnding } from '@front-burner/shared-contracts';
import { createHash } from 'node:crypto';

/** What the editor edits, and what is needed to write it back unchanged (ED-12). */
export interface MarkdownText {
  /** With `\n` line breaks and without a byte order mark. */
  content: string;
  lineEnding: LineEnding;
  bom: boolean;
}

const BOM = Buffer.from([ 0xef, 0xbb, 0xbf ]);

/** `ignoreBOM`: the mark is removed by `decodeMarkdown` itself, so that it can be reported. */
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

const count = (text: string, pattern: RegExp): number => text.match(pattern)?.length ?? 0;

/**
 * A Markdown file's bytes as the editor edits them (ED-12). The line ending is
 * `crlf` when the file has more `\r\n` than lone `\n`, else `lf`; every `\r\n`
 * becomes `\n` and a lone `\r` is kept.
 */
export function decodeMarkdown(bytes: Buffer): MarkdownText | 'not-utf8' {
  const bom = bytes.subarray(0, BOM.length).equals(BOM);
  let text: string;
  try {
    text = decoder.decode(bom ? bytes.subarray(BOM.length) : bytes);
  } catch {
    return 'not-utf8';
  }
  const crlf = count(text, /\r\n/g);
  const lf = count(text, /(?<!\r)\n/g);
  return { content: text.replace(/\r\n/g, '\n'), lineEnding: crlf > lf ? 'crlf' : 'lf', bom };
}

/** The bytes to store for the editor's text: every `\n` as the file's line ending, and the BOM if it had one. */
export function encodeMarkdown(text: MarkdownText): Buffer {
  const content = text.lineEnding === 'crlf' ? text.content.replace(/\n/g, '\r\n') : text.content;
  const bytes = Buffer.from(content, 'utf8');
  return text.bom ? Buffer.concat([ BOM, bytes ]) : bytes;
}

/** SHA-256 of a file's bytes, lower-case hex (ED-6, ED-24). */
export const hashBytes = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
