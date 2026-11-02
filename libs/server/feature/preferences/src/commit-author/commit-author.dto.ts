import {
  CommitAuthorPreferenceSchema,
  CommitAuthorSchema,
  RepositoryCommitAuthorSchema
} from '@front-burner/shared-contracts';
import { ApiSchema } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

@ApiSchema({ name: 'CommitAuthor' })
export class CommitAuthorDto extends createZodDto(
  z.object(CommitAuthorSchema.shape).meta({ required: [ 'name', 'email' ] })
) {}

@ApiSchema({ name: 'CommitAuthorPreference' })
export class CommitAuthorPreferenceDto extends createZodDto(z.object(CommitAuthorPreferenceSchema.shape)) {}

@ApiSchema({ name: 'RepositoryCommitAuthor' })
export class RepositoryCommitAuthorDto extends createZodDto(z.object(RepositoryCommitAuthorSchema.shape)) {}
