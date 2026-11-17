import { Module } from '@nestjs/common';
import { InstanceStorageController } from './instance-storage.controller';

/** The instance's own state for administrators, such as its storage (NF-9.7). Needs the global `StorageModule`. */
@Module({ controllers: [ InstanceStorageController ] })
export class InstanceModule {}
