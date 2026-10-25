import { DynamicModule, Global, Module } from '@nestjs/common';
import { Config } from './config.model';

/** Injection token for the instance {@link Config}. */
export const CONFIG = 'FRONT_BURNER_CONFIG';

@Global()
@Module({})
export class ConfigModule {
  static forRoot(config: Config): DynamicModule {
    return {
      module: ConfigModule,
      providers: [ { provide: CONFIG, useValue: config } ],
      exports: [ CONFIG ]
    };
  }
}
