import { PendingLogins } from './pending-logins';

const login = (n = 1) => ({
  codeVerifier: `verifier-${n}`,
  nonce: `nonce-${n}`,
  redirectUri: 'https://fb.example.com/cb'
});

describe('PendingLogins', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns a pending login once', () => {
    const pending = new PendingLogins();
    pending.add('state-1', login());
    expect(pending.take('state-1')).toEqual(login());
    expect(pending.take('state-1')).toBeUndefined();
    expect(pending.take('unknown')).toBeUndefined();
  });

  it('forgets a pending login after 10 minutes', () => {
    vi.useFakeTimers({ toFake: [ 'Date' ] });
    const pending = new PendingLogins();
    pending.add('state-1', login(1));
    pending.add('state-2', login(2));
    vi.advanceTimersByTime(9 * 60_000);
    expect(pending.take('state-1')).toEqual(login(1));
    vi.advanceTimersByTime(60_001);
    expect(pending.take('state-2')).toBeUndefined();
  });

  it('drops the oldest beyond 1 000 entries', () => {
    const pending = new PendingLogins();
    for (let n = 0; n <= 1000; n++) {
      pending.add(`state-${n}`, login(n));
    }
    expect(pending.take('state-0')).toBeUndefined();
    expect(pending.take('state-1')).toEqual(login(1));
    expect(pending.take('state-1000')).toEqual(login(1000));
  });
});
