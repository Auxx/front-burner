import { CONFIG, Config } from '@front-burner/server-core-config';
import { Global, Module } from '@nestjs/common';
import { DiskMonitor } from './disk/disk-monitor';
import { DATA_LAYOUT, DataLayout } from './layout/data-layout';

/** The data directory's layout (A-2) and its free space (NF-9.7). Global, so that any feature can find its files. */
@Global()
@Module({
  providers: [ {
    provide: DATA_LAYOUT,
    useFactory: (config: Config) => new DataLayout(config.dataDir, config.reposRoot),
    inject: [ CONFIG ]
  }, DiskMonitor ],
  exports: [ DATA_LAYOUT, DiskMonitor ]
})
export class StorageModule {}
