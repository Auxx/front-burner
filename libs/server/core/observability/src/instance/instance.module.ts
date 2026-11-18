import { Module } from '@nestjs/common';
import { DiskMetrics } from './disk-metrics';
import { InstanceStorageController } from './instance-storage.controller';

/**
 * The instance's own state for administrators, such as its storage (NF-9.7),
 * and its free space as a metric (NF-10.11). Needs the global `StorageModule`
 * and `MetricsModule`.
 */
@Module({ controllers: [ InstanceStorageController ], providers: [ DiskMetrics ] })
export class InstanceModule {}
