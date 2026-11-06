import { authOf } from '@front-burner/server-core-security';
import type { RepositoryCredentialsInfo } from '@front-burner/shared-contracts';
import { Controller, Get, Param, Req } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ZodSerializerDto } from 'nestjs-zod';
import { RepositoryCredentialsInfoDto, RepositoryParamsDto } from '../repositories/repositories.dto';
import { RepositoryCredentialsService } from './repository-credentials.service';

/** The credentials a repository of the logged-in user uses (RC-1, RC-7). */
@ApiTags('repositories')
@Controller('repositories')
export class RepositoryCredentialsController {
  constructor(private readonly credentials: RepositoryCredentialsService) {}

  /**
   * The remote's protocol and the credentials in use, without secrets; a key's
   * `unlocked` is in this session (RC-20). Does not keep a key unlocked.
   */
  @Get(':id/credentials')
  @ApiOkResponse({ type: RepositoryCredentialsInfoDto })
  @ZodSerializerDto(RepositoryCredentialsInfoDto)
  repositoryCredentials(@Req() req: Request, @Param() params: RepositoryParamsDto): RepositoryCredentialsInfo {
    const { userId, sessionId } = authOf(req);
    return this.credentials.get(userId, sessionId, params.id);
  }
}
