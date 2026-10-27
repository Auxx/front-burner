import { OidcExchangeRequestSchema } from '@front-burner/shared-contracts';
import { ApiSchema } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// As in auth.dto.ts: built from the schema's shape, named after its id.

@ApiSchema({ name: 'OidcExchangeRequest' })
export class OidcExchangeRequestDto extends createZodDto(z.object(OidcExchangeRequestSchema.shape)) {}
