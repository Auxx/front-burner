import { DynamicModule, Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { Database } from './open-database';

/** Injection token for the instance {@link Database}. */
export const DATABASE = 'FRONT_BURNER_DATABASE';

@Global()
@Module({})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  static forRoot(database: Database): DynamicModule {
    return {
      module: DatabaseModule,
      providers: [ { provide: DATABASE, useValue: database } ],
      exports: [ DATABASE ]
    };
  }

  /** Closes the connection (A-1.14); this also checkpoints the WAL. */
  onApplicationShutdown(): void {
    this.database.sqlite.close();
  }
}
