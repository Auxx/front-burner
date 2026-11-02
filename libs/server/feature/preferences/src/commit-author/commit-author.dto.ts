import {
  CommitAuthorPreferenceSchema,
  CommitAuthorSchema,
  RepositoryCommitAuthorSchema,
  RepositoryParamsSchema
} from '@front-burner/shared-contracts';
import { ApiSchema } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

@ApiSchema({ name: 'CommitAuthor' })
export class CommitAuthorDto extends createZodDto(z.object(CommitAuthorSchema.shape)) {}

@ApiSchema({ name: 'CommitAuthorPreference' })
export class CommitAuthorPreferenceDto extends createZodDto(z.object(CommitAuthorPreferenceSchema.shape)) {}

@ApiSchema({ name: 'RepositoryCommitAuthor' })
export class RepositoryCommitAuthorDto extends createZodDto(z.object(RepositoryCommitAuthorSchema.shape)) {}

@ApiSchema({ name: 'RepositoryParams' })
export class RepositoryParamsDto extends createZodDto(z.object(RepositoryParamsSchema.shape)) {}
