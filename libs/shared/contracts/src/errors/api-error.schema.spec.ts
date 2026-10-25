import { z } from 'zod';
import { ApiErrorSchema, FieldErrorSchema } from './api-error.schema';

describe('ApiErrorSchema', () => {
  const valid = {
    code: 'not-found',
    params: {},
    requestId: 'r1',
    message: 'Not found'
  };

  it('parses a minimal error body', () => {
    expect(ApiErrorSchema.parse(valid)).toEqual(valid);
  });

  it('accepts a code newer than the client', () => {
    expect(ApiErrorSchema.parse({ ...valid, code: 'some-future-code' }).code)
      .toBe('some-future-code');
  });

  it('parses field errors', () => {
    const fields = [ { path: 'email', code: 'invalid-email', params: {} } ];
    expect(ApiErrorSchema.parse({ ...valid, fields }).fields).toEqual(fields);
  });

  it('rejects a body without requestId', () => {
    const body: Partial<typeof valid> = { ...valid };
    delete body.requestId;
    expect(ApiErrorSchema.safeParse(body).success).toBe(false);
  });

  it('registers the schemas for OpenAPI', () => {
    expect(z.globalRegistry.get(ApiErrorSchema)?.id).toBe('ApiError');
    expect(z.globalRegistry.get(FieldErrorSchema)?.id).toBe('FieldError');
  });
});
