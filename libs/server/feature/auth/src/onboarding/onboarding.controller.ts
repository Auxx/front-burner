import { Public, RateLimitGroup } from '@front-burner/server-core-security';
import type { OidcSetupView, OnboardingStatus } from '@front-burner/shared-contracts';
import { Body, Controller, Get, HttpCode, Logger, NotFoundException, Post, UseGuards } from '@nestjs/common';
import { ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { OidcSetupService } from './oidc-setup.service';
import { OnboardingStateService } from './onboarding-state.service';
import {
  OidcSetupRequestDto,
  OidcSetupViewDto,
  OnboardingStatusDto,
  PasswordSetupRequestDto,
  SetupTokenRequestDto
} from './onboarding.dto';
import { OnboardingGuard } from './onboarding.guard';
import { OnboardingService } from './onboarding.service';

/**
 * Administrator onboarding, username + password and OIDC paths (REQ-AUTH-001). Every
 * refusal is the `404` of an unknown route (AO-3); see {@link OnboardingGuard}.
 */
@ApiTags('onboarding')
@Public()
@UseGuards(OnboardingGuard)
@Controller('onboarding')
export class OnboardingController {
  private readonly logger = new Logger(OnboardingController.name);

  constructor(
    private readonly state: OnboardingStateService,
    private readonly onboarding: OnboardingService,
    private readonly oidcSetup: OidcSetupService
  ) {}

  /** The onboarding state, for clients to decide what to show (AO-5). */
  @Get()
  @ApiOkResponse({ type: OnboardingStatusDto })
  status(): OnboardingStatus {
    return this.state.status();
  }

  /** Checks the setup token before the user chooses a login method (AO-10, AO-14). */
  @Post('setup-token/check')
  @HttpCode(204)
  @RateLimitGroup('setup-token')
  @ApiNoContentResponse()
  checkSetupToken(@Body() _request: SetupTokenRequestDto): void {
    this.logger.log('Administrator onboarding started');
  }

  /** Creates the first administrator with a password (AO-17, AO-19). */
  @Post('password-setup')
  @HttpCode(204)
  @RateLimitGroup('setup-token')
  @ApiNoContentResponse()
  async setUpPassword(@Body() request: PasswordSetupRequestDto): Promise<void> {
    await this.onboarding.setUpPassword(request);
  }

  /** Checks the provider and saves the OIDC setup; onboarding becomes `oidc-pending` (AO-23, AO-24). */
  @Post('oidc-setup')
  @HttpCode(204)
  @RateLimitGroup('setup-token')
  @ApiNoContentResponse()
  async saveOidcSetup(@Body() request: OidcSetupRequestDto): Promise<void> {
    await this.oidcSetup.save(request);
  }

  /**
   * The saved OIDC setup without its secret, to pre-fill the form (AO-16, AO-26).
   * A `POST`, because the setup token travels in the body.
   */
  @Post('oidc-setup/current')
  @HttpCode(200)
  @RateLimitGroup('setup-token')
  @ApiOkResponse({ type: OidcSetupViewDto })
  currentOidcSetup(@Body() _request: SetupTokenRequestDto): OidcSetupView {
    const view = this.oidcSetup.current();
    if (view === undefined) {
      throw new NotFoundException();
    }
    return view;
  }
}
