import {
  CommitRequestSchema,
  CommitResultSchema,
  GitBranchListSchema,
  GitDiffQuerySchema,
  GitDiffSchema,
  GitIncomingQuerySchema,
  GitIncomingSchema,
  GitJobParamsSchema,
  GitJobStartedSchema,
  GitJobStateSchema,
  GitMergeStateSchema,
  GitNewBranchRequestSchema,
  GitPathsSchema,
  GitStatusSchema,
  GitSwitchRequestSchema,
  hasPathsUnlessAmending
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

// The shape does not carry the rule across its fields, so it is applied again.
@ApiSchema({ name: 'CommitRequest' })
export class CommitRequestDto
  extends createZodDto(z.object(CommitRequestSchema.shape).refine(hasPathsUnlessAmending, { path: [ 'paths' ] })) {}

@ApiSchema({ name: 'CommitResult' })
export class CommitResultDto extends createZodDto(z.object(CommitResultSchema.shape)) {}

@ApiSchema({ name: 'GitPaths' })
export class GitPathsDto extends createZodDto(z.object(GitPathsSchema.shape)) {}

@ApiSchema({ name: 'GitJobStarted' })
export class GitJobStartedDto extends createZodDto(z.object(GitJobStartedSchema.shape)) {}

@ApiSchema({ name: 'GitJobParams' })
export class GitJobParamsDto extends createZodDto(z.object(GitJobParamsSchema.shape)) {}

@ApiSchema({ name: 'GitJobState' })
export class GitJobStateDto extends createZodDto(z.object(GitJobStateSchema.shape)) {}

@ApiSchema({ name: 'GitIncomingQuery' })
export class GitIncomingQueryDto extends createZodDto(z.object(GitIncomingQuerySchema.shape)) {}

@ApiSchema({ name: 'GitIncoming' })
export class GitIncomingDto extends createZodDto(z.object(GitIncomingSchema.shape)) {}

@ApiSchema({ name: 'GitMergeState' })
export class GitMergeStateDto extends createZodDto(z.object(GitMergeStateSchema.shape)) {}

@ApiSchema({ name: 'GitBranchList' })
export class GitBranchListDto extends createZodDto(z.object(GitBranchListSchema.shape)) {}

@ApiSchema({ name: 'GitSwitchRequest' })
export class GitSwitchRequestDto extends createZodDto(z.object(GitSwitchRequestSchema.shape)) {}

@ApiSchema({ name: 'GitNewBranchRequest' })
export class GitNewBranchRequestDto extends createZodDto(z.object(GitNewBranchRequestSchema.shape)) {}
