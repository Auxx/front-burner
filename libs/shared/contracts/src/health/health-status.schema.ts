import { z } from 'zod';

/** The body of the health endpoint (A-3.8, NF-10.8). */
export const HealthStatusSchema = z
  .object({ status: z.enum([ 'ok', 'degraded', 'fail' ]) })
  .meta({ id: 'HealthStatus' });

export type HealthStatus = z.infer<typeof HealthStatusSchema>;
