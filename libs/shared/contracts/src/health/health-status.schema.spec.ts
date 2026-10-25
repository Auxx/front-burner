import { z } from 'zod';
import { HealthStatusSchema } from './health-status.schema';

describe('HealthStatusSchema', () => {
  it.each([ 'ok', 'degraded', 'fail' ])('parses %s', status => {
    expect(HealthStatusSchema.parse({ status })).toEqual({ status });
  });

  it('rejects an unknown status', () => {
    expect(HealthStatusSchema.safeParse({ status: 'up' }).success).toBe(false);
  });

  it('registers the schema for OpenAPI', () => {
    expect(z.globalRegistry.get(HealthStatusSchema)?.id).toBe('HealthStatus');
  });
});
