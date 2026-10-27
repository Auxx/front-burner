import { CONFIG, Config } from '@front-burner/server-core-config';
import { Global, Module } from '@nestjs/common';
import { DATA_LAYOUT, DataLayout } from './layout/data-layout';

/** The data directory's layout (A-2). Global, so that any feature can find its files. */
@Global()
@Module({
  providers: [ {
    provide: DATA_LAYOUT,
    useFactory: (config: Config) => new DataLayout(config.dataDir),
    inject: [ CONFIG ]
  } ],
  exports: [ DATA_LAYOUT ]
})
export class StorageModule {}
