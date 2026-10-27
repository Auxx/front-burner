import { ApiErrorException } from '@front-burner/server-core-observability';
import { Public, RateLimitGroup } from '@front-burner/server-core-security';
import type { LoginMethods, SessionTokens } from '@front-burner/shared-contracts';
import { Body, Controller, Get, HttpCode, Logger, Post, Req, Res, UseFilters } from '@nestjs/common';
import { ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { ZodSerializerDto } from 'nestjs-zod';
import { OidcProviderService } from '../oidc/oidc-provider.service';
import { SessionService } from '../sessions/session.service';
import { LoginMethodsDto, LoginRequestDto, RefreshRequestDto, SessionTokensDto } from './auth.dto';
import { PasswordLoginService } from './password-login.service';
import { RateLimitAuditFilter } from './rate-limit-audit.filter';
import { answerWithSession, clearRefreshCookie, readRefreshToken } from './refresh-cookie';
import { requestInfoOf } from './request-info';

/** Login, refresh and logout (REQ-AUTH-003). Every route here works without an auth token. */
@ApiTags('auth')
@Public()
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly passwordLogin: PasswordLoginService,
    private readonly sessions: SessionService,
    private readonly oidcProvider: OidcProviderService
  ) {}

  /** The login methods of the instance (LG-7, LG-8). Password reset comes later. */
  @Get('methods')
  @ApiOkResponse({ type: LoginMethodsDto })
  async methods(): Promise<LoginMethods> {
    return { oidc: await this.oidcProvider.availability(), passwordReset: false };
  }

  /** Username + password login (LG-10 to LG-16). With cookie delivery the refresh token is only in the cookie. */
  @Post('login')
  @HttpCode(200)
  @RateLimitGroup('login')
  @UseFilters(RateLimitAuditFilter)
  @ApiOkResponse({ type: SessionTokensDto })
  @ZodSerializerDto(SessionTokensDto)
  async login(
    @Body() request: LoginRequestDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ): Promise<SessionTokens> {
    return answerWithSession(await this.passwordLogin.login(request, requestInfoOf(req)), res);
  }

  /** Exchanges a refresh token for new tokens and rotates it (LG-35, LG-36). */
  @Post('session/refresh')
  @HttpCode(200)
  @ApiOkResponse({ type: SessionTokensDto })
  @ZodSerializerDto(SessionTokensDto)
  async refresh(
    @Body() body: RefreshRequestDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ): Promise<SessionTokens> {
    const refreshToken = readRefreshToken(req, body);
    if (refreshToken === undefined) {
      throw new ApiErrorException(401, 'refresh-refused');
    }
    return answerWithSession(await this.sessions.refresh(refreshToken), res);
  }

  /** Ends the session of a refresh token and clears its cookie (LG-39). */
  @Post('session/logout')
  @HttpCode(204)
  @ApiNoContentResponse()
  logout(@Body() body: RefreshRequestDto, @Req() req: Request, @Res({ passthrough: true }) res: Response): void {
    const refreshToken = readRefreshToken(req, body);
    if (refreshToken !== undefined) {
      this.sessions.revokeByRefreshToken(refreshToken);
    }
    clearRefreshCookie(res);
    this.logger.log('Logout');
  }
}
