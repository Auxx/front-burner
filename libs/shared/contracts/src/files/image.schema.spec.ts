import { z } from 'zod';
import { ImageQuerySchema } from './image.schema';

describe('image', () => {
  it('registers the schema for OpenAPI', () => {
    expect(z.globalRegistry.get(ImageQuerySchema)?.id).toBe('ImageQuery');
  });

  it('parses a query', () => {
    expect(ImageQuerySchema.parse({ path: 'docs/logo.png' })).toEqual({ path: 'docs/logo.png' });
    expect(ImageQuerySchema.safeParse({}).success).toBe(false);
  });
});
