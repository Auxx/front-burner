import { CommitRequestSchema, CommitResultSchema, GitStatusSchema } from '@front-burner/shared-contracts';
import { ApiSchema } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// As RepositorySummaryDto: built from the schema's shape without its id.

@ApiSchema({ name: 'GitStatus' })
export class GitStatusDto extends createZodDto(z.object(GitStatusSchema.shape)) {}

@ApiSchema({ name: 'CommitRequest' })
export class CommitRequestDto extends createZodDto(z.object(CommitRequestSchema.shape)) {}

@ApiSchema({ name: 'CommitResult' })
export class CommitResultDto extends createZodDto(z.object(CommitResultSchema.shape)) {}
