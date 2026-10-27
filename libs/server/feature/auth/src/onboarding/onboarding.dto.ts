import {
  OidcSetupRequestSchema,
  OidcSetupViewSchema,
  OnboardingStatusSchema,
  PasswordSetupRequestSchema,
  refinePasswordNotEmail,
  SetupTokenRequestSchema
} from '@front-burner/shared-contracts';
import { ApiSchema } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// As HealthStatusDto: each DTO is built from the schema's shape without its id,
// and the OpenAPI component keeps the id's name. A shape copy drops object
// refinements, so the password setup DTO applies its own again.

@ApiSchema({ name: 'OnboardingStatus' })
export class OnboardingStatusDto extends createZodDto(z.object(OnboardingStatusSchema.shape)) {}

@ApiSchema({ name: 'SetupTokenRequest' })
export class SetupTokenRequestDto extends createZodDto(z.object(SetupTokenRequestSchema.shape)) {}

@ApiSchema({ name: 'PasswordSetupRequest' })
export class PasswordSetupRequestDto extends createZodDto(
  z.object(PasswordSetupRequestSchema.shape).superRefine(refinePasswordNotEmail)
) {}

@ApiSchema({ name: 'OidcSetupRequest' })
export class OidcSetupRequestDto extends createZodDto(z.object(OidcSetupRequestSchema.shape)) {}

@ApiSchema({ name: 'OidcSetupView' })
export class OidcSetupViewDto extends createZodDto(z.object(OidcSetupViewSchema.shape)) {}
