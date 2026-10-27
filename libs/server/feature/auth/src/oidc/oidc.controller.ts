import { CONFIG, Config } from '@front-burner/server-core-config';
import { Public, RateLimitGroup } from '@front-burner/server-core-security';
import type { SessionTokens } from '@front-burner/shared-contracts';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Logger,
  NotFoundException,
  Post,
  Req,
  Res,
  UseFilters
} from '@nestjs/common';
import { ApiFoundResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { ZodSerializerDto } from 'nestjs-zod';
import { SessionTokensDto } from '../login/auth.dto';
import { LoginAuditService } from '../login/login-audit.service';
import { answerWithSession } from '../login/refresh-cookie';
import { requestInfoOf } from '../login/request-info';
import { OnboardingStateService } from '../onboarding/onboarding-state.service';
import { OidcLoginService } from './oidc-login.service';
import { reasonOf } from './oidc-provider.service';
import { OidcRateLimitFilter } from './oidc-rate-limit.filter';
import {
  OIDC_STATE_COOKIE,
  OIDC_STATE_COOKIE_MAX_AGE_MS,
  OIDC_STATE_COOKIE_OPTIONS,
  oidcFailureLocation
} from './oidc-redirects';
import { OidcSettingsService } from './oidc-settings.service';
import { OidcExchangeRequestDto } from './oidc.dto';

const CALLBACK_PATH = '/api/v1/auth/oidc/callback';

/** The site's own origin, honouring `trust proxy` (A-1.15). */
const originOf = (req: Request) => `${req.protocol}://${req.get('host') ?? ''}`;

/** OIDC login (LG-17 to LG-23). Every route here works without an auth token. */
@ApiTags('oidc')
@Public()
@Controller('auth/oidc')
export class OidcController {
  private readonly logger = new Logger(OidcController.name);

  constructor(
    private readonly login: OidcLoginService,
    private readonly settings: OidcSettingsService,
    private readonly onboardingState: OnboardingStateService,
    private readonly audit: LoginAuditService,
    @Inject(CONFIG) private readonly config: Pick<Config, 'oidc'>
  ) {}

  /** Sends the browser to the provider, with the `state` in a short-lived cookie (LG-17). */
  @Get('start')
  @ApiFoundResponse({ description: 'To the OIDC provider, or back to the web client when it cannot be reached.' })
  async start(@Req() req: Request, @Res() res: Response): Promise<void> {
    if (this.settings.current() === undefined) {
      throw new NotFoundException();
    }
    let started: Awaited<ReturnType<OidcLoginService['start']>>;
    try {
      started = await this.login.start(`${originOf(req)}${CALLBACK_PATH}`);
    } catch (error) {
      this.logger.error(`OIDC provider discovery failed: ${reasonOf(error)}`);
      this.audit.record({ method: 'oidc', outcome: 'failure', reason: 'provider-unreachable', ...requestInfoOf(req) });
      res.redirect(302, this.failureLocation('provider-unreachable'));
      return;
    }
    res.cookie(OIDC_STATE_COOKIE, started.state, {
      ...OIDC_STATE_COOKIE_OPTIONS,
      maxAge: OIDC_STATE_COOKIE_MAX_AGE_MS
    });
    res.redirect(302, started.authorizationUrl.href);
  }

  /** The provider's redirect: a one-time code for the web client, or a failure (LG-21, LG-22, AO-26, AO-34). */
  @Get('callback')
  @RateLimitGroup('oidc')
  @UseFilters(OidcRateLimitFilter)
  @ApiFoundResponse({ description: 'To /login/oidc with a one-time code, or to the page that shows the failure.' })
  async callback(@Req() req: Request, @Res() res: Response): Promise<void> {
    const cookie = (req.cookies as Record<string, unknown> | undefined)?.[OIDC_STATE_COOKIE];
    res.clearCookie(OIDC_STATE_COOKIE, OIDC_STATE_COOKIE_OPTIONS);
    res.setHeader('Cache-Control', 'no-store');
    const outcome = await this.login.complete(
      new URL(req.originalUrl, originOf(req)),
      typeof cookie === 'string' && cookie !== '' ? cookie : undefined,
      requestInfoOf(req)
    );
    if (outcome.ok === false) {
      res.redirect(302, this.failureLocation(outcome.reason));
      return;
    }
    res.redirect(302, `/login/oidc?code=${encodeURIComponent(outcome.code)}`);
  }

  /** Exchanges the one-time code for session tokens, delivered as for a password login (LG-22, LG-23). */
  @Post('exchange')
  @HttpCode(200)
  @RateLimitGroup('oidc')
  @UseFilters(OidcRateLimitFilter)
  @ApiOkResponse({ type: SessionTokensDto })
  @ZodSerializerDto(SessionTokensDto)
  async exchange(
    @Body() body: OidcExchangeRequestDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ): Promise<SessionTokens> {
    return answerWithSession(await this.login.exchange(body.code, body.refreshTokenDelivery, requestInfoOf(req)), res);
  }

  private failureLocation(reason: Parameters<typeof oidcFailureLocation>[0]): string {
    return oidcFailureLocation(reason, this.onboardingState.current(), this.config.oidc !== undefined);
  }
}
