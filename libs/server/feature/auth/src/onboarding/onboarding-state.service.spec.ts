import type { Config } from '@front-burner/server-core-config';
import { Database, instanceState, users } from '@front-burner/server-core-database';
import { createTestDatabase } from '../testing/test-database';
import { OnboardingStateService } from './onboarding-state.service';

const config = { setupToken: 'a-setup-token-0123456789' } as Config;

const alice = {
  email: 'alice@example.com',
  displayName: 'Alice',
  role: 'administrator',
  loginMethod: 'password',
  passwordHash: '$argon2id$hash',
  createdAt: new Date()
} as const;

describe('OnboardingStateService', () => {
  let database: Database;

  beforeEach(() => {
    database = createTestDatabase();
  });

  afterEach(() => {
    database.sqlite.close();
  });

  const service = (withConfig: Config = config) => {
    const created = new OnboardingStateService(database, withConfig);
    created.onModuleInit();
    return created;
  };

  it('is required on an empty database', () => {
    expect(service().current()).toBe('required');
    expect(database.db.select().from(instanceState).all()).toEqual([ { id: 1, onboardingState: 'required' } ]);
  });

  it('is completed when a user exists', () => {
    database.db.insert(users).values(alice).run();
    expect(service().current()).toBe('completed');
  });

  it('repairs a required row when a user exists', () => {
    database.db.insert(instanceState).values({ id: 1, onboardingState: 'required' }).run();
    database.db.insert(users).values(alice).run();
    expect(service().current()).toBe('completed');
  });

  it('keeps a completed row', () => {
    database.db.insert(instanceState).values({ id: 1, onboardingState: 'completed' }).run();
    service();
    expect(service().current()).toBe('completed');
  });

  it('reads the state on every call', () => {
    const created = service();
    database.db.update(instanceState).set({ onboardingState: 'completed' }).run();
    expect(created.current()).toBe('completed');
  });

  it('reports whether a setup token is configured', () => {
    expect(service().status()).toEqual({
      state: 'required',
      oidcFromEnvironment: false,
      setupTokenConfigured: true
    });
    expect(service({ setupToken: undefined } as Config).status().setupTokenConfigured).toBe(false);
  });
});
