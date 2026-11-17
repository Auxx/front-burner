import { z } from 'zod';
import { InstanceStorageSchema } from './instance-storage.schema';

describe('InstanceStorageSchema', () => {
  it.each([ true, false ])('parses low: %s', low => {
    expect(InstanceStorageSchema.parse({ low })).toEqual({ low });
  });

  it('rejects a missing state', () => {
    expect(InstanceStorageSchema.safeParse({}).success).toBe(false);
  });

  it('registers the schema for OpenAPI', () => {
    expect(z.globalRegistry.get(InstanceStorageSchema)?.id).toBe('InstanceStorage');
  });
});
