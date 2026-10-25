import type { Config } from '@front-burner/server-core-config';
import { Database, users } from '@front-burner/server-core-database';
import { NotFoundException } from '@nestjs/common';
import { PasswordHasher } from '../passwords/password-hasher';
import { createTestDatabase } from '../testing/test-database';
import { OnboardingStateService } from './onboarding-state.service';
import { OnboardingService } from './onboarding.service';

const request = (email: string) => ({
  setupToken: 'a-setup-token-0123456789',
  email,
  displayName: 'Admin',
  password: 'abcdefghi1'
});

describe('OnboardingService', () => {
  let database: Database;
  let service: OnboardingService;
  let state: OnboardingStateService;

  beforeEach(() => {
    database = createTestDatabase();
    state = new OnboardingStateService(database, { setupToken: 'a-setup-token-0123456789' } as Config);
    state.onModuleInit();
    service = new OnboardingService(database, new PasswordHasher());
  });

  afterEach(() => {
    database.sqlite.close();
  });

  it('creates the administrator and completes onboarding', async () => {
    await service.setUpPassword(request('alice@example.com'));
    expect(state.current()).toBe('completed');
    expect(database.db.select().from(users).all()).toHaveLength(1);
  });

  it('of two concurrent setups exactly one succeeds', async () => {
    const results = await Promise.allSettled([
      service.setUpPassword(request('alice@example.com')),
      service.setUpPassword(request('bob@example.com'))
    ]);

    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter(result => result.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(NotFoundException);
    expect(database.db.select().from(users).all()).toHaveLength(1);
  });

  it('refuses once onboarding is completed', async () => {
    await service.setUpPassword(request('alice@example.com'));
    await expect(service.setUpPassword(request('bob@example.com'))).rejects.toBeInstanceOf(NotFoundException);
  });
});
