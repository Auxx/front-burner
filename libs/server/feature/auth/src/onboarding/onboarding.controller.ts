import { Public, RateLimitGroup } from '@front-burner/server-core-security';
import type { OnboardingStatus } from '@front-burner/shared-contracts';
import { Body, Controller, Get, HttpCode, Logger, Post, UseGuards } from '@nestjs/common';
import { ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { OnboardingStateService } from './onboarding-state.service';
import { OnboardingStatusDto, PasswordSetupRequestDto, SetupTokenRequestDto } from './onboarding.dto';
import { OnboardingGuard } from './onboarding.guard';
import { OnboardingService } from './onboarding.service';

/**
 * Administrator onboarding, username + password path (REQ-AUTH-001). Every
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
    private readonly onboarding: OnboardingService
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
}
