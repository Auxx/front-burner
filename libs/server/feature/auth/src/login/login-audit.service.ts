import { DATABASE, Database, loginAudit, NewLoginAuditEntry } from '@front-burner/server-core-database';
import { Inject, Injectable, Logger } from '@nestjs/common';

const MAX_USER_AGENT_LENGTH = 512;

/** Every field of LG-42 except the ID and the time, which the service sets. */
export type AuditInput = Omit<NewLoginAuditEntry, 'id' | 'at'>;

/** Where a login request came from. */
export interface RequestInfo {
  ip: string;
  userAgent: string | undefined;
}

/** Writes the login audit log (LG-41 to LG-47). It never holds a secret (LG-44). */
@Injectable()
export class LoginAuditService {
  private readonly logger = new Logger(LoginAuditService.name);

  constructor(@Inject(DATABASE) private readonly database: Database) {}

  /** Records an entry; a failure to write it is logged and never stops the login (LG-46). */
  record(input: AuditInput): void {
    const entry = { ...input, userAgent: input.userAgent?.slice(0, MAX_USER_AGENT_LENGTH) };
    // Email addresses go to the log only at debug (NF-10.5).
    const { email, ...loggable } = entry;
    if (entry.outcome === 'failure') {
      const message = entry.reason === 'refresh-token-reused' ? 'Refresh token reused' : 'Login failed';
      // The provider's error code helps operators (LG-47); its description may name the user.
      const providerError = entry.providerError ? { providerError: entry.providerError } : {};
      this.logger.log({ reason: entry.reason, method: entry.method, ...providerError }, message);
      this.logger.debug({ reason: entry.reason, email }, message);
    }
    try {
      this.database.db.insert(loginAudit).values({ ...entry, at: new Date() }).run();
    } catch (error) {
      this.logger.error({ err: error, entry: loggable }, 'Could not write the login audit entry');
      this.logger.debug({ email }, 'Could not write the login audit entry');
    }
  }
}
