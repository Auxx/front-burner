import { Session } from '@front-burner/server-core-database';
import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { LoginAuditService } from './login/login-audit.service';
import { OnboardingModule } from './onboarding/onboarding.module';
import { AuthTokenService } from './sessions/auth-token.service';
import { AuthGuard } from './sessions/auth.guard';
import { AuthMiddleware } from './sessions/auth.middleware';
import { SESSION_REUSE_HANDLER, SessionReuseHandler, SessionService } from './sessions/session.service';

/**
 * Authentication: sessions, the auth token check on every request, and
 * administrator onboarding. Every route needs an auth token unless it is
 * marked `@Public()` (LG-34, A-1.12).
 */
@Module({
  imports: [ OnboardingModule ],
  providers: [
    AuthTokenService,
    SessionService,
    LoginAuditService,
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
