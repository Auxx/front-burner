import {
  AccessCheckRequestSchema,
  AccessCheckResultSchema,
  AddRepositoryRequestSchema,
  RecentRepositoriesSchema,
  refineAddRepository,
  refineCredentialsProtocol,
  RepositoryIndexSchema,
  RepositorySummarySchema
} from '@front-burner/shared-contracts';
import { ApiSchema } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// As OnboardingStatusDto: built from the schema's shape without its id. A
// shape copy drops object refinements, so the request DTOs apply theirs again.

@ApiSchema({ name: 'RecentRepositories' })
export class RecentRepositoriesDto extends createZodDto(z.object(RecentRepositoriesSchema.shape)) {}

@ApiSchema({ name: 'RepositorySummary' })
export class RepositorySummaryDto extends createZodDto(z.object(RepositorySummarySchema.shape)) {}

@ApiSchema({ name: 'RepositoryIndex' })
export class RepositoryIndexDto extends createZodDto(z.object(RepositoryIndexSchema.shape)) {}

@ApiSchema({ name: 'AccessCheckRequest' })
export class AccessCheckRequestDto extends createZodDto(
  z.object(AccessCheckRequestSchema.shape).superRefine(refineCredentialsProtocol)
) {}

@ApiSchema({ name: 'AccessCheckResult' })
export class AccessCheckResultDto extends createZodDto(z.object(AccessCheckResultSchema.shape)) {}

@ApiSchema({ name: 'AddRepositoryRequest' })
export class AddRepositoryRequestDto extends createZodDto(
  z.object(AddRepositoryRequestSchema.shape).superRefine(refineAddRepository)
) {}
