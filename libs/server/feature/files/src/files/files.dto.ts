import {
  CreateEntryRequestSchema,
  EntryPathSchema,
  FolderListingSchema,
  FolderQuerySchema,
  RenameEntryRequestSchema
} from '@front-burner/shared-contracts';
import { ApiSchema } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// As RepositorySummaryDto: built from the schema's shape without its id.

@ApiSchema({ name: 'FolderListing' })
export class FolderListingDto extends createZodDto(z.object(FolderListingSchema.shape)) {}

@ApiSchema({ name: 'FolderQuery' })
export class FolderQueryDto extends createZodDto(z.object(FolderQuerySchema.shape)) {}

@ApiSchema({ name: 'CreateEntryRequest' })
export class CreateEntryRequestDto extends createZodDto(z.object(CreateEntryRequestSchema.shape)) {}

@ApiSchema({ name: 'RenameEntryRequest' })
export class RenameEntryRequestDto extends createZodDto(z.object(RenameEntryRequestSchema.shape)) {}

@ApiSchema({ name: 'EntryPath' })
export class EntryPathDto extends createZodDto(z.object(EntryPathSchema.shape)) {}
