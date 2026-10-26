import { Database, loginAudit } from '@front-burner/server-core-database';
import { Logger } from '@nestjs/common';
import { createTestDatabase } from '../testing/test-database';
import { AuditInput, LoginAuditService } from './login-audit.service';

const NOW = new Date('2026-10-26T12:00:00Z');
const failure: AuditInput = {
  method: 'password',
  outcome: 'failure',
  reason: 'wrong-password',
  email: 'alice@x.io',
  userId: null,
  ip: '203.0.113.7',
  userAgent: 'Browser'
};

describe('LoginAuditService', () => {
  let database: Database;
  let service: LoginAuditService;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: [ 'Date' ] });
    vi.setSystemTime(NOW);
    database = createTestDatabase();
    service = new LoginAuditService(database);
  });

  afterEach(() => {
    database.sqlite.close();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('records an entry with its time', () => {
    service.record(failure);
    expect(database.db.select().from(loginAudit).all()).toEqual([
      expect.objectContaining({ ...failure, id: 1, at: NOW, sessionId: null })
    ]);
  });

  it('cuts the user agent to 512 characters', () => {
    service.record({ ...failure, userAgent: 'x'.repeat(600) });
    expect(database.db.select().from(loginAudit).get()?.userAgent).toHaveLength(512);
  });

  it('logs a failure with its reason and method only, and the email at debug', () => {
    const info = vi.spyOn(Logger.prototype, 'log');
    const debug = vi.spyOn(Logger.prototype, 'debug');
    service.record(failure);

    expect(info).toHaveBeenCalledWith({ reason: 'wrong-password', method: 'password' }, 'Login failed');
    expect(JSON.stringify(info.mock.calls)).not.toContain('alice@x.io');
    expect(JSON.stringify(debug.mock.calls)).toContain('alice@x.io');
  });

  it('does not log a success', () => {
    const info = vi.spyOn(Logger.prototype, 'log');
    service.record({ ...failure, outcome: 'success', reason: 'success', sessionId: 's' });
    expect(info).not.toHaveBeenCalled();
  });

  it('logs the entry when it cannot be written, and goes on', () => {
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    database.sqlite.exec('DROP TABLE login_audit');

    expect(() => service.record(failure)).not.toThrow();
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error), entry: expect.objectContaining({ reason: 'wrong-password' }) }),
      'Could not write the login audit entry'
    );
    // Email addresses go to the log only at debug (NF-10.5).
    expect(JSON.stringify(error.mock.calls)).not.toContain('alice@x.io');
  });
});
