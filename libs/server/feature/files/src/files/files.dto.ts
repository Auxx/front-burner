import {
  CreateEntryRequestSchema,
  EntryPathSchema,
  EntryQuerySchema,
  EntrySummarySchema,
  FileContentSchema,
  FileQuerySchema,
  FileStateSchema,
  FolderListingSchema,
  FolderQuerySchema,
  IgnoreQuerySchema,
  IgnoreResultSchema,
  ImageQuerySchema,
  RenameEntryRequestSchema,
  SaveFileRequestSchema
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

@ApiSchema({ name: 'EntryQuery' })
export class EntryQueryDto extends createZodDto(z.object(EntryQuerySchema.shape)) {}

@ApiSchema({ name: 'EntrySummary' })
export class EntrySummaryDto extends createZodDto(z.object(EntrySummarySchema.shape)) {}

@ApiSchema({ name: 'IgnoreQuery' })
export class IgnoreQueryDto extends createZodDto(z.object(IgnoreQuerySchema.shape)) {}

@ApiSchema({ name: 'IgnoreResult' })
export class IgnoreResultDto extends createZodDto(z.object(IgnoreResultSchema.shape)) {}

@ApiSchema({ name: 'FileQuery' })
export class FileQueryDto extends createZodDto(z.object(FileQuerySchema.shape)) {}

@ApiSchema({ name: 'FileContent' })
export class FileContentDto extends createZodDto(z.object(FileContentSchema.shape)) {}

@ApiSchema({ name: 'SaveFileRequest' })
export class SaveFileRequestDto extends createZodDto(z.object(SaveFileRequestSchema.shape)) {}

@ApiSchema({ name: 'FileState' })
export class FileStateDto extends createZodDto(z.object(FileStateSchema.shape)) {}

@ApiSchema({ name: 'ImageQuery' })
export class ImageQueryDto extends createZodDto(z.object(ImageQuerySchema.shape)) {}
