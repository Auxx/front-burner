import { Module } from '@nestjs/common';
import { PasswordHasher } from '../passwords/password-hasher';
import { OnboardingStateService } from './onboarding-state.service';
import { OnboardingController } from './onboarding.controller';
import { OnboardingGuard } from './onboarding.guard';
import { OnboardingService } from './onboarding.service';

@Module({
  controllers: [ OnboardingController ],
  providers: [ OnboardingStateService, OnboardingService, OnboardingGuard, PasswordHasher ],
  exports: [ OnboardingStateService ]
})
export class OnboardingModule {}
