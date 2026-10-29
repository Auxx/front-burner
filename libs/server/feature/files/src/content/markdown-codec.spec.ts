import { createHash } from 'node:crypto';
import { decodeMarkdown, encodeMarkdown, hashBytes } from './markdown-codec';

const BOM = Buffer.from([ 0xef, 0xbb, 0xbf ]);

/** Decodes `bytes`, failing the test if they are not UTF-8. */
function decoded(bytes: Buffer) {
  const text = decodeMarkdown(bytes);
  if (text === 'not-utf8') {
    throw new Error('expected UTF-8');
  }
  return text;
}

describe('Markdown codec', () => {
  it('AC-EDIT-001.9: keeps CRLF, the BOM, tabs and a missing final newline after an edit', () => {
    const bytes = Buffer.concat([ BOM, Buffer.from('# Title\r\n\r\n\tindented  \r\nlast line') ]);
    const text = decoded(bytes);
    expect(text).toEqual({ content: '# Title\n\n\tindented  \nlast line', lineEnding: 'crlf', bom: true });

    const edited = encodeMarkdown({ ...text, content: text.content.replace('Title', 'New title') });
    expect(edited).toEqual(Buffer.concat([ BOM, Buffer.from('# New title\r\n\r\n\tindented  \r\nlast line') ]));
  });

  it('round-trips uniform files byte for byte', () => {
    const files = [
      Buffer.from('# A\nb\n'),
      Buffer.from('# A\r\nb\r\n'),
      Buffer.concat([ BOM, Buffer.from('# A\nb\n') ]),
      Buffer.from('no final newline'),
      Buffer.from('ünïcødé\r\nlast'),
      Buffer.alloc(0),
      BOM
    ];
    for (const bytes of files) {
      expect(encodeMarkdown(decoded(bytes))).toEqual(bytes);
    }
  });

  it('uses the most common line ending', () => {
    const text = decoded(Buffer.from('a\r\nb\r\nc\nd'));
    expect(text).toEqual({ content: 'a\nb\nc\nd', lineEnding: 'crlf', bom: false });
    expect(encodeMarkdown(text)).toEqual(Buffer.from('a\r\nb\r\nc\r\nd'));

    expect(decoded(Buffer.from('a\nb\nc\r\nd')).lineEnding).toBe('lf');
  });

  it('treats a tie as LF', () => {
    expect(decoded(Buffer.from('a\r\nb\nc')).lineEnding).toBe('lf');
    expect(decoded(Buffer.from('one line')).lineEnding).toBe('lf');
  });

  it('leaves a lone CR alone', () => {
    const text = decoded(Buffer.from('a\rb\r\nc\r\n'));
    expect(text.content).toBe('a\rb\nc\n');
    expect(text.lineEnding).toBe('crlf');
    expect(encodeMarkdown(text)).toEqual(Buffer.from('a\rb\r\nc\r\n'));
  });

  it('reports Latin-1 bytes as not UTF-8', () => {
    expect(decodeMarkdown(Buffer.from([ 0x63, 0x61, 0x66, 0xe9 ]))).toBe('not-utf8');
  });

  it('hashes the bytes', () => {
    const bytes = Buffer.from('# A\n');
    expect(hashBytes(bytes)).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(hashBytes(bytes)).toMatch(/^[0-9a-f]{64}$/);
  });
});
