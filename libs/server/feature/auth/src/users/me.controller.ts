import { DATABASE, Database, users } from '@front-burner/server-core-database';
import { ApiErrorException } from '@front-burner/server-core-observability';
import type { CurrentUser } from '@front-burner/shared-contracts';
import { Controller, Get, Inject, Req } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { eq } from 'drizzle-orm';
import type { Request } from 'express';
import { ZodSerializerDto } from 'nestjs-zod';
import { CurrentUserDto } from '../login/auth.dto';

/** The user of the auth token. */
@ApiTags('me')
@Controller('me')
export class MeController {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  @Get()
  @ApiOkResponse({ type: CurrentUserDto })
  @ZodSerializerDto(CurrentUserDto)
  current(@Req() req: Request): CurrentUser {
    const user = req.auth === undefined
      ? undefined
      : this.database.db.select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        role: users.role
      }).from(users).where(eq(users.id, req.auth.userId)).get();
    if (user === undefined) {
      throw new ApiErrorException(401, 'unauthenticated');
    }
    return user;
  }
}
