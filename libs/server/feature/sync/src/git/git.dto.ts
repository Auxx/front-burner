import {
  CommitRequestSchema,
  CommitResultSchema,
  GitDiffQuerySchema,
  GitDiffSchema,
  GitStatusSchema
} from '@front-burner/shared-contracts';
import { ApiSchema } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// As RepositorySummaryDto: built from the schema's shape without its id.

@ApiSchema({ name: 'GitStatus' })
export class GitStatusDto extends createZodDto(z.object(GitStatusSchema.shape)) {}

@ApiSchema({ name: 'GitDiffQuery' })
export class GitDiffQueryDto extends createZodDto(z.object(GitDiffQuerySchema.shape)) {}

// A union has no shape to copy, so it is rebuilt from its members without its
// id; and it cannot be a class's base, so the class createZodDto makes is named
// by calling the decorator.
export const GitDiffDto = createZodDto(z.discriminatedUnion('kind', GitDiffSchema.options));
ApiSchema({ name: 'GitDiff' })(GitDiffDto);

@ApiSchema({ name: 'CommitRequest' })
export class CommitRequestDto extends createZodDto(z.object(CommitRequestSchema.shape)) {}

@ApiSchema({ name: 'CommitResult' })
export class CommitResultDto extends createZodDto(z.object(CommitResultSchema.shape)) {}
