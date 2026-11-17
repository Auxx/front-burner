import { AdminOnly } from '@front-burner/server-core-security';
import { DiskMonitor } from '@front-burner/server-core-storage';
import { type InstanceStorage, InstanceStorageSchema } from '@front-burner/shared-contracts';
import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiSchema, ApiTags } from '@nestjs/swagger';
import { createZodDto, ZodSerializerDto } from 'nestjs-zod';
import { z } from 'zod';

// As HealthStatusDto: built from the schema's shape without its id.
@ApiSchema({ name: 'InstanceStorage' })
export class InstanceStorageDto extends createZodDto(z.object(InstanceStorageSchema.shape)) {}

/**
 * The instance's storage, for the administrators' low-space banner (NF-9.7).
 * It belongs to the instance, not to a user, so it is not part of `/me`; and
 * it is not under `/admin/`, which is for administering users and their
 * repositories (A-7.4) _(plan 132's call)_.
 */
@ApiTags('instance')
@AdminOnly()
@Controller('instance')
export class InstanceStorageController {
  constructor(private readonly disk: DiskMonitor) {}

  /** Whether the server is low on storage, as of the disk monitor's last check. */
  @Get('storage')
  @ApiOkResponse({ type: InstanceStorageDto })
  @ZodSerializerDto(InstanceStorageDto)
  storage(): InstanceStorage {
    return { low: this.disk.isLow() };
  }
}
