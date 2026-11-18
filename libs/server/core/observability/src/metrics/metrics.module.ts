import { Config } from '@front-burner/server-core-config';
import { DynamicModule, Global, Module, Provider } from '@nestjs/common';
import { collectDefaultMetrics, Registry } from 'prom-client';
import { METRICS_PREFIX, METRICS_REGISTRY, METRICS_TOKEN } from './metrics-registry';
import { MetricsController } from './metrics.controller';

/**
 * Prometheus metrics at `/api/metrics` (NF-10.10). Off unless
 * `FRONT_BURNER_METRICS_TOKEN` is set: the endpoint then does not exist, and
 * Node's process metrics are not collected. Global, so that any library can
 * inject {@link METRICS_REGISTRY}.
 */
@Global()
@Module({})
export class MetricsModule {
  static forRoot(config: Pick<Config, 'metricsToken'>): DynamicModule {
    const { metricsToken } = config;
    const registry: Provider = {
      provide: METRICS_REGISTRY,
      useFactory: () => {
        const created = new Registry();
        if (metricsToken !== undefined) {
          collectDefaultMetrics({ register: created, prefix: METRICS_PREFIX });
        }
        return created;
      }
    };
    return {
      module: MetricsModule,
      controllers: metricsToken === undefined ? [] : [ MetricsController ],
      providers: [ registry, { provide: METRICS_TOKEN, useValue: metricsToken } ],
      exports: [ METRICS_REGISTRY ]
    };
  }
}
