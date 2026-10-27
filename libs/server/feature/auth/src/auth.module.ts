import { Session } from '@front-burner/server-core-database';
import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthHousekeeping } from './housekeeping/auth-housekeeping';
import { AuthController } from './login/auth.controller';
import { LoginAuditService } from './login/login-audit.service';
import { PasswordLoginService } from './login/password-login.service';
import { RateLimitAuditFilter } from './login/rate-limit-audit.filter';
import { OidcLoginService } from './oidc/oidc-login.service';
import { OidcProviderService } from './oidc/oidc-provider.service';
import { OidcRateLimitFilter } from './oidc/oidc-rate-limit.filter';
import { OidcSettingsService } from './oidc/oidc-settings.service';
import { OidcUserService } from './oidc/oidc-user.service';
import { OidcController } from './oidc/oidc.controller';
import { OneTimeCodes } from './oidc/one-time-codes';
import { PendingLogins } from './oidc/pending-logins';
import { OnboardingModule } from './onboarding/onboarding.module';
import { PasswordHasher } from './passwords/password-hasher';
import { AuthTokenService } from './sessions/auth-token.service';
import { AuthGuard } from './sessions/auth.guard';
import { AuthMiddleware } from './sessions/auth.middleware';
import { SESSION_REUSE_HANDLER, SessionReuseHandler, SessionService } from './sessions/session.service';
import { MeController } from './users/me.controller';

/**
 * Authentication: sessions, the auth token check on every request, and
 * administrator onboarding. Every route needs an auth token unless it is
 * marked `@Public()` (LG-34, A-1.12).
 */
@Module({
  imports: [ OnboardingModule ],
  controllers: [ AuthController, OidcController, MeController ],
  providers: [
    AuthTokenService,
    SessionService,
    LoginAuditService,
    PasswordHasher,
    PasswordLoginService,
    RateLimitAuditFilter,
    OidcSettingsService,
    OidcProviderService,
    OidcUserService,
    OidcLoginService,
    PendingLogins,
    OneTimeCodes,
    OidcRateLimitFilter,
    AuthHousekeeping,
    {
      provide: SESSION_REUSE_HANDLER,
      inject: [ LoginAuditService ],
      useFactory: (audit: LoginAuditService): SessionReuseHandler => (session: Session) =>
        audit.record({
          method: session.loginMethod,
          outcome: 'failure',
          reason: 'refresh-token-reused',
          userId: session.userId,
          sessionId: session.id
        })
    },
    { provide: APP_GUARD, useClass: AuthGuard }
  ],
  exports: [ SessionService ]
})
export class AuthModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(AuthMiddleware).forRoutes({ path: '*path', method: RequestMethod.ALL });
  }
}
