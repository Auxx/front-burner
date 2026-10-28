import { ENTRY_NAME_PROBLEMS } from '@front-burner/shared-util';
import { z } from 'zod';
import {
  CreateEntryRequestSchema,
  EntryNameSchema,
  EntryPathSchema,
  EntryQuerySchema,
  EntrySummarySchema,
  IgnoreQuerySchema,
  IgnoreResultSchema,
  RenameEntryRequestSchema
} from './entry-actions.schema';

const issueCode = (name: string) => {
  const result = EntryNameSchema.safeParse(name);
  return result.success ? null : (result.error.issues[0] as { params?: { code?: string; }; }).params?.code;
};

describe('entry actions', () => {
  it('registers the schemas for OpenAPI', () => {
    expect(z.globalRegistry.get(CreateEntryRequestSchema)?.id).toBe('CreateEntryRequest');
    expect(z.globalRegistry.get(RenameEntryRequestSchema)?.id).toBe('RenameEntryRequest');
    expect(z.globalRegistry.get(EntryPathSchema)?.id).toBe('EntryPath');
    expect(z.globalRegistry.get(EntryQuerySchema)?.id).toBe('EntryQuery');
    expect(z.globalRegistry.get(EntrySummarySchema)?.id).toBe('EntrySummary');
    expect(z.globalRegistry.get(IgnoreQuerySchema)?.id).toBe('IgnoreQuery');
    expect(z.globalRegistry.get(IgnoreResultSchema)?.id).toBe('IgnoreResult');
  });

  it('reports each name problem as its code', () => {
    const examples: Record<(typeof ENTRY_NAME_PROBLEMS)[number], string> = {
      empty: '',
      dot: '..',
      separator: 'a/b',
      control: 'a\u0007b',
      'edge-space': ' a',
      git: '.Git',
      'too-long': 'é'.repeat(200)
    };
    for (const problem of ENTRY_NAME_PROBLEMS) {
      expect(issueCode(examples[problem])).toBe(problem);
    }
    expect(issueCode('notes.md')).toBeNull();
  });

  it('parses a create request', () => {
    const request = { folder: 'docs', name: 'notes', kind: 'file' };
    expect(CreateEntryRequestSchema.parse(request)).toEqual(request);
    expect(CreateEntryRequestSchema.safeParse({ ...request, kind: 'symlink' }).success).toBe(false);
  });

  it('parses a rename request', () => {
    expect(RenameEntryRequestSchema.parse({ path: 'docs/a.md', name: 'b.md' })).toEqual({
      path: 'docs/a.md',
      name: 'b.md'
    });
    expect(RenameEntryRequestSchema.safeParse({ path: 'docs/a.md', name: '' }).success).toBe(false);
  });
});
