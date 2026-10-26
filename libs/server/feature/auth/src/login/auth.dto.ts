import {
  CurrentUserSchema,
  LoginMethodsSchema,
  LoginRequestSchema,
  RefreshRequestSchema,
  SessionTokensSchema
} from '@front-burner/shared-contracts';
import { ApiSchema } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// As OnboardingStatusDto: each DTO is built from the schema's shape without its
// id, and the OpenAPI component keeps the id's name.

@ApiSchema({ name: 'LoginRequest' })
export class LoginRequestDto extends createZodDto(z.object(LoginRequestSchema.shape)) {}

@ApiSchema({ name: 'SessionTokens' })
export class SessionTokensDto extends createZodDto(z.object(SessionTokensSchema.shape)) {}

@ApiSchema({ name: 'RefreshRequest' })
export class RefreshRequestDto extends createZodDto(z.object(RefreshRequestSchema.shape)) {}

@ApiSchema({ name: 'LoginMethods' })
export class LoginMethodsDto extends createZodDto(z.object(LoginMethodsSchema.shape)) {}

@ApiSchema({ name: 'CurrentUser' })
export class CurrentUserDto extends createZodDto(z.object(CurrentUserSchema.shape)) {}
