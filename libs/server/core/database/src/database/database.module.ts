import { DynamicModule, Global, Module } from '@nestjs/common';
import { Database } from './open-database';

/** Injection token for the instance {@link Database}. */
export const DATABASE = 'FRONT_BURNER_DATABASE';

@Global()
@Module({})
export class DatabaseModule {
  static forRoot(database: Database): DynamicModule {
    return {
      module: DatabaseModule,
      providers: [ { provide: DATABASE, useValue: database } ],
      exports: [ DATABASE ]
    };
  }
}
