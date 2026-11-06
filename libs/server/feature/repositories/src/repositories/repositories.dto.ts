import {
  AccessCheckRequestSchema,
  AccessCheckResultSchema,
  AddRepositoryRequestSchema,
  RecentQuerySchema,
  RecentRepositoriesSchema,
  refineAddRepository,
  refineCredentialsProtocol,
  RepositoryCredentialsInfoSchema,
  RepositoryCredentialsSchema,
  RepositoryIndexSchema,
  RepositoryParamsSchema,
  RepositorySummarySchema,
  UpdateTokenRequestSchema
} from '@front-burner/shared-contracts';
import { ApiSchema } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// As OnboardingStatusDto: built from the schema's shape without its id. A
// shape copy drops object refinements, so the request DTOs apply theirs again.

@ApiSchema({ name: 'RecentRepositories' })
export class RecentRepositoriesDto extends createZodDto(z.object(RecentRepositoriesSchema.shape)) {}

@ApiSchema({ name: 'RecentQuery' })
export class RecentQueryDto extends createZodDto(z.object(RecentQuerySchema.shape)) {}

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

@ApiSchema({ name: 'RepositoryParams' })
export class RepositoryParamsDto extends createZodDto(z.object(RepositoryParamsSchema.shape)) {}

@ApiSchema({ name: 'RepositoryCredentialsInfo' })
export class RepositoryCredentialsInfoDto extends createZodDto(z.object(RepositoryCredentialsInfoSchema.shape)) {}

// The body of `PUT …/credentials`: the request's union, as on the Add repository
// page (RC-7). As GitDiffDto: rebuilt from its members without its id, and
// named by calling the decorator, since a union cannot be a class's base.
export const RepositoryCredentialsDto = createZodDto(z.discriminatedUnion('mode', RepositoryCredentialsSchema.options));
ApiSchema({ name: 'RepositoryCredentials' })(RepositoryCredentialsDto);

@ApiSchema({ name: 'UpdateTokenRequest' })
export class UpdateTokenRequestDto extends createZodDto(z.object(UpdateTokenRequestSchema.shape)) {}
