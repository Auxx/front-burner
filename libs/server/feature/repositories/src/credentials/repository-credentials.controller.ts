import { authOf, RateLimitGroup } from '@front-burner/server-core-security';
import type { RepositoryCredentials, RepositoryCredentialsInfo } from '@front-burner/shared-contracts';
import { Body, Controller, Get, Param, Put, Req } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ZodSerializerDto, ZodValidationPipe } from 'nestjs-zod';
import {
  RepositoryCredentialsDto,
  RepositoryCredentialsInfoDto,
  RepositoryParamsDto,
  UpdateTokenRequestDto
} from '../repositories/repositories.dto';
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

  /**
   * Makes the repository use other credentials once an access check with them
   * passes (RC-8); new ones are saved, and the old ones are kept (RC-10).
   * Limited with the Add repository page's access checks (AR-55).
   */
  @Put(':id/credentials')
  @RateLimitGroup('access-check')
  @ApiBody({ type: RepositoryCredentialsDto })
  @ApiOkResponse({ type: RepositoryCredentialsInfoDto })
  @ZodSerializerDto(RepositoryCredentialsInfoDto)
  replaceRepositoryCredentials(
    @Req() req: Request,
    @Param() params: RepositoryParamsDto,
    // A union's type is no class for the global pipe to find, so the body names its DTO.
    @Body(new ZodValidationPipe(RepositoryCredentialsDto)) body: RepositoryCredentials
  ): Promise<RepositoryCredentialsInfo> {
    const { userId, sessionId } = authOf(req);
    return this.credentials.replace({ id: userId, sessionId }, params.id, body);
  }

  /**
   * Updates the username and token of the saved HTTPS credentials the
   * repository uses, once an access check against it passes (RC-13), for
   * every repository that uses them. `409 credentials-not-updatable` for
   * anything else (RC-14).
   */
  @Put(':id/credentials/token')
  @RateLimitGroup('access-check')
  @ApiOkResponse({ type: RepositoryCredentialsInfoDto })
  @ZodSerializerDto(RepositoryCredentialsInfoDto)
  updateRepositoryToken(
    @Req() req: Request,
    @Param() params: RepositoryParamsDto,
    @Body() body: UpdateTokenRequestDto
  ): Promise<RepositoryCredentialsInfo> {
    const { userId, sessionId } = authOf(req);
    return this.credentials.updateToken({ id: userId, sessionId }, params.id, body);
  }
}
