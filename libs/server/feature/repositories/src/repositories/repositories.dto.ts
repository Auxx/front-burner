import { RecentRepositoriesSchema } from '@front-burner/shared-contracts';
import { ApiSchema } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// As OnboardingStatusDto: built from the schema's shape without its id.

@ApiSchema({ name: 'RecentRepositories' })
export class RecentRepositoriesDto extends createZodDto(z.object(RecentRepositoriesSchema.shape)) {}
