import { DynamicModule, Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { MIGRATIONS_APPLIED, ReadinessService } from './readiness.service';

@Module({})
export class HealthModule {
  static forRoot(options: { migrationsApplied: boolean; }): DynamicModule {
    return {
      module: HealthModule,
      controllers: [ HealthController ],
      providers: [ ReadinessService, { provide: MIGRATIONS_APPLIED, useValue: options.migrationsApplied } ]
    };
  }
}
