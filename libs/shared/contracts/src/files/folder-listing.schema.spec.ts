import { z } from 'zod';
import { EntrySchema, FolderListingSchema, FolderQuerySchema } from './folder-listing.schema';

const entry = { name: 'guide.md', kind: 'file', size: 120, markdown: true, ignored: false, empty: false };

describe('FolderListingSchema', () => {
  it('registers the schemas for OpenAPI', () => {
    expect(z.globalRegistry.get(EntrySchema)?.id).toBe('Entry');
    expect(z.globalRegistry.get(FolderListingSchema)?.id).toBe('FolderListing');
    expect(z.globalRegistry.get(FolderQuerySchema)?.id).toBe('FolderQuery');
  });

  it('parses a listing', () => {
    const listing = { path: 'docs', ignored: false, entries: [ entry ], more: 0 };
    expect(FolderListingSchema.parse(listing)).toEqual(listing);
  });

  it('refuses an unknown kind', () => {
    expect(EntrySchema.safeParse({ ...entry, kind: 'device' }).success).toBe(false);
  });
});

describe('FolderQuerySchema', () => {
  it('defaults the path to the root', () => {
    expect(FolderQuerySchema.parse({})).toEqual({ path: '' });
  });
});
