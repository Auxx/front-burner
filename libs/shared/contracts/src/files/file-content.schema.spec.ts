import { z } from 'zod';
import { FileContentSchema, FileQuerySchema, FileStateSchema, SaveFileRequestSchema } from './file-content.schema';

describe('file contents', () => {
  it('registers the schemas for OpenAPI', () => {
    expect(z.globalRegistry.get(FileQuerySchema)?.id).toBe('FileQuery');
    expect(z.globalRegistry.get(FileContentSchema)?.id).toBe('FileContent');
    expect(z.globalRegistry.get(SaveFileRequestSchema)?.id).toBe('SaveFileRequest');
    expect(z.globalRegistry.get(FileStateSchema)?.id).toBe('FileState');
  });

  it('parses a save request', () => {
    const request = { path: 'docs/a.md', content: '# A\n', lineEnding: 'crlf', bom: true };
    expect(SaveFileRequestSchema.parse(request)).toEqual(request);
    expect(SaveFileRequestSchema.safeParse({ ...request, lineEnding: 'cr' }).success).toBe(false);
  });
});
