import { DATABASE, Database, LoginAuditReason, User, users } from '@front-burner/server-core-database';
import { ApiErrorException } from '@front-burner/server-core-observability';
import type { LoginRequest } from '@front-burner/shared-contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { PasswordHasher } from '../passwords/password-hasher';
import { IssuedSession, SessionService } from '../sessions/session.service';
import { LoginAuditService, RequestInfo } from './login-audit.service';

/** Username + password login (LG-10 to LG-16). */
@Injectable()
export class PasswordLoginService {
  private readonly logger = new Logger(PasswordLoginService.name);

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly hasher: PasswordHasher,
    private readonly sessions: SessionService,
    private readonly audit: LoginAuditService
  ) {}

  /**
   * Logs a password user in. Every failure answers the same (LG-14), and
   * every attempt runs one hash check of the same cost (LG-15).
   *
   * @throws ApiErrorException `wrong-credentials` (401).
   */
  async login(request: LoginRequest, info: RequestInfo): Promise<IssuedSession> {
    const email = request.email.trim();
    const user = this.database.db.select().from(users).where(sql`lower(${users.email}) = lower(${email})`).get();
    const passwordHash = user?.loginMethod === 'password' ? user.passwordHash : null;
    const passwordMatches = passwordHash === null
      ? await this.hasher.verifyAgainstDummy(request.password)
      : await this.hasher.verify(passwordHash, request.password);

    const reason = failureReason(user, passwordMatches);
    const entry = {
      method: 'password',
      email,
      userId: user?.id ?? null,
      ip: info.ip,
      userAgent: info.userAgent
    } as const;
    if (user === undefined || reason !== undefined) {
      this.audit.record({ ...entry, outcome: 'failure', reason: reason ?? 'unknown-email' });
      throw new ApiErrorException(401, 'wrong-credentials', {}, 'Wrong username or password');
    }

    const issued = await this.sessions.start(user, 'password', request.refreshTokenDelivery);
    this.audit.record({ ...entry, outcome: 'success', reason: 'success', sessionId: issued.sessionId });
    this.logger.log({ userId: user.id, sessionId: issued.sessionId, method: 'password' }, 'Login succeeded');
    return issued;
  }
}

/** The reasons of LG-43, checked in this order (LG-13). */
function failureReason(user: User | undefined, passwordMatches: boolean): LoginAuditReason | undefined {
  if (user === undefined) {
    return 'unknown-email';
  }
  if (user.loginMethod !== 'password') {
    return 'not-password-user';
  }
  if (user.passwordHash === null) {
    return 'onboarding-not-finished';
  }
  if (!passwordMatches) {
    return 'wrong-password';
  }
  if (user.disabled) {
    return 'user-disabled';
  }
  return undefined;
}
