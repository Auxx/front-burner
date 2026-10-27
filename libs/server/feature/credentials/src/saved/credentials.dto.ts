import {
  GeneratedSshKeySchema,
  GenerateSshKeyRequestSchema,
  SavedCredentialsSchema,
  TrustHostRequestSchema,
  UnlockSshKeyRequestSchema
} from '@front-burner/shared-contracts';
import { ApiSchema } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// As OnboardingStatusDto: built from the schema's shape without its id.

@ApiSchema({ name: 'SavedCredentials' })
export class SavedCredentialsDto extends createZodDto(z.object(SavedCredentialsSchema.shape)) {}

@ApiSchema({ name: 'GenerateSshKeyRequest' })
export class GenerateSshKeyRequestDto extends createZodDto(z.object(GenerateSshKeyRequestSchema.shape)) {}

@ApiSchema({ name: 'GeneratedSshKey' })
export class GeneratedSshKeyDto extends createZodDto(z.object(GeneratedSshKeySchema.shape)) {}

@ApiSchema({ name: 'UnlockSshKeyRequest' })
export class UnlockSshKeyRequestDto extends createZodDto(z.object(UnlockSshKeyRequestSchema.shape)) {}

@ApiSchema({ name: 'TrustHostRequest' })
export class TrustHostRequestDto extends createZodDto(z.object(TrustHostRequestSchema.shape)) {}
