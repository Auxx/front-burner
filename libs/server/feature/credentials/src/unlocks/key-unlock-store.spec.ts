import type { Config } from '@front-burner/server-core-config';
import { EventsHub } from '@front-burner/server-core-events';
import { SshKeyError, UnlockedKey } from '@front-burner/server-core-git';
import { FIXTURE_PASSPHRASE, sshKeyFixture } from '@front-burner/server-core-git/testing';
import { SessionLifecycle } from '@front-burner/server-core-security';
import { KeyUnlockStore } from './key-unlock-store';

const IDLE = 60 * 60_000;
const PROTECTED = sshKeyFixture('ed25519-passphrase');

describe('KeyUnlockStore', () => {
  let lifecycle: SessionLifecycle;
  let store: KeyUnlockStore;
  let events: EventsHub;

  beforeEach(() => {
    vi.useFakeTimers();
    lifecycle = new SessionLifecycle();
    events = new EventsHub();
    store = new KeyUnlockStore({ keyUnlockIdleMs: IDLE } as Config, lifecycle, events);
  });

  afterEach(() => {
    store.onModuleDestroy();
    vi.useRealTimers();
  });

  it('unlocks with the right passphrase', () => {
    store.unlock('s1', 7, PROTECTED, FIXTURE_PASSPHRASE);

    expect(store.isUnlocked('s1', 7)).toBe(true);
    expect(store.get('s1', 7, { touch: false })).toBeInstanceOf(UnlockedKey);
  });

  it('an unlock reaches only its own session', () => {
    const tab = { userId: 1, sessionId: 's1', repositoryId: null, send: vi.fn(), close: vi.fn() };
    const otherDevice = { userId: 1, sessionId: 's2', repositoryId: null, send: vi.fn(), close: vi.fn() };
    events.open(tab);
    events.open(otherDevice);

    store.unlock('s1', 7, PROTECTED, FIXTURE_PASSPHRASE);

    expect(tab.send).toHaveBeenCalledExactlyOnceWith({ type: 'key.unlocked', keyId: 7 });
    expect(otherDevice.send).not.toHaveBeenCalled();
    expect(store.isUnlocked('s2', 7)).toBe(false);
  });

  it('refuses a wrong passphrase', () => {
    expect(() => store.unlock('s1', 7, PROTECTED, 'wrong')).toThrow(
      expect.objectContaining({ constructor: SshKeyError, problem: 'wrong-passphrase' })
    );
    expect(store.isUnlocked('s1', 7)).toBe(false);
  });

  it('tells no one about a wrong passphrase', () => {
    const publish = vi.spyOn(events, 'publishToSession');

    expect(() => store.unlock('s1', 7, PROTECTED, 'wrong')).toThrow(SshKeyError);
    expect(publish).not.toHaveBeenCalled();
  });

  it('keeps an unlock to its session', () => {
    store.unlock('s1', 7, PROTECTED, FIXTURE_PASSPHRASE);

    expect(store.isUnlocked('s2', 7)).toBe(false);
    expect(store.get('s2', 7, { touch: true })).toBeUndefined();
    expect(store.isUnlocked('s1', 8)).toBe(false);
  });

  it('locks after the idle time', () => {
    store.unlock('s1', 7, PROTECTED, FIXTURE_PASSPHRASE);

    vi.advanceTimersByTime(IDLE - 1);
    expect(store.isUnlocked('s1', 7)).toBe(true);
    vi.advanceTimersByTime(1);
    expect(store.isUnlocked('s1', 7)).toBe(false);
    expect(store.get('s1', 7, { touch: true })).toBeUndefined();
  });

  it('tells only its own session when an unlock ends by its idle time', () => {
    const tab = { userId: 1, sessionId: 's1', repositoryId: null, send: vi.fn(), close: vi.fn() };
    const otherDevice = { userId: 1, sessionId: 's2', repositoryId: null, send: vi.fn(), close: vi.fn() };
    events.open(tab);
    events.open(otherDevice);
    store.unlock('s1', 7, PROTECTED, FIXTURE_PASSPHRASE);
    tab.send.mockClear();

    vi.advanceTimersByTime(IDLE);

    expect(tab.send).toHaveBeenCalledExactlyOnceWith({ type: 'key.locked', keyId: 7 });
    expect(otherDevice.send).not.toHaveBeenCalled();
  });

  it('says nothing when a key is unlocked again, or locked on purpose', () => {
    const publish = vi.spyOn(events, 'publishToSession');
    store.unlock('s1', 7, PROTECTED, FIXTURE_PASSPHRASE);
    store.unlock('s1', 7, PROTECTED, FIXTURE_PASSPHRASE);
    store.lock('s1', 7);

    expect(publish.mock.calls.map(([ , event ]) => event.type)).toEqual([ 'key.unlocked', 'key.unlocked' ]);
  });

  it('extends the unlock on a git operation', () => {
    store.unlock('s1', 7, PROTECTED, FIXTURE_PASSPHRASE);

    vi.advanceTimersByTime(IDLE - 1000);
    expect(store.get('s1', 7, { touch: true })).toBeDefined();
    vi.advanceTimersByTime(IDLE - 1000);

    expect(store.isUnlocked('s1', 7)).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(store.isUnlocked('s1', 7)).toBe(false);
  });

  it('does not extend the unlock when only looking', () => {
    store.unlock('s1', 7, PROTECTED, FIXTURE_PASSPHRASE);

    vi.advanceTimersByTime(IDLE - 1000);
    expect(store.get('s1', 7, { touch: false })).toBeDefined();
    expect(store.isUnlocked('s1', 7)).toBe(true);
    vi.advanceTimersByTime(1000);

    expect(store.isUnlocked('s1', 7)).toBe(false);
  });

  it('locks one key', () => {
    store.unlock('s1', 7, PROTECTED, FIXTURE_PASSPHRASE);
    store.unlock('s1', 8, PROTECTED, FIXTURE_PASSPHRASE);

    store.lock('s1', 7);

    expect(store.isUnlocked('s1', 7)).toBe(false);
    expect(store.isUnlocked('s1', 8)).toBe(true);
  });

  it('drops a revoked session\'s unlocks', () => {
    store.unlock('s1', 7, PROTECTED, FIXTURE_PASSPHRASE);
    store.unlock('s1', 8, PROTECTED, FIXTURE_PASSPHRASE);
    store.unlock('s2', 7, PROTECTED, FIXTURE_PASSPHRASE);

    lifecycle.notifyRevoked('s1');

    expect(store.isUnlocked('s1', 7)).toBe(false);
    expect(store.isUnlocked('s1', 8)).toBe(false);
    expect(store.isUnlocked('s2', 7)).toBe(true);
  });

  it('forgets a credential in every session', () => {
    store.unlock('s1', 7, PROTECTED, FIXTURE_PASSPHRASE);
    store.unlock('s2', 7, PROTECTED, FIXTURE_PASSPHRASE);
    store.unlock('s2', 8, PROTECTED, FIXTURE_PASSPHRASE);

    store.forgetCredential(7);

    expect(store.isUnlocked('s1', 7)).toBe(false);
    expect(store.isUnlocked('s2', 7)).toBe(false);
    expect(store.isUnlocked('s2', 8)).toBe(true);
  });

  it('leaves no timer behind', () => {
    store.unlock('s1', 7, PROTECTED, FIXTURE_PASSPHRASE);
    store.lock('s1', 7);
    expect(vi.getTimerCount()).toBe(0);
  });
});
