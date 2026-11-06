import { UNLOCK_ATTEMPT_LIMIT, UNLOCK_ATTEMPT_WINDOW_MS, UnlockAttempts } from './unlock-attempts';

const tooMany = expect.objectContaining({ code: 'unlock-too-many-attempts' });

describe('UnlockAttempts', () => {
  let attempts: UnlockAttempts;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: [ 'performance', 'Date' ] });
    attempts = new UnlockAttempts();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows five wrong attempts and refuses the sixth', () => {
    expect(UNLOCK_ATTEMPT_LIMIT).toBe(5);
    for (let attempt = 0; attempt < 5; attempt++) {
      attempts.assertAllowed(1, 7);
      attempts.recordWrong(1, 7);
    }

    expect(() => attempts.assertAllowed(1, 7)).toThrow(tooMany);
    attempts.assertAllowed(1, 8);
    attempts.assertAllowed(2, 7);
  });

  it('allows an attempt again 60 seconds after the oldest wrong one', () => {
    expect(UNLOCK_ATTEMPT_WINDOW_MS).toBe(60_000);
    attempts.recordWrong(1, 7);
    vi.advanceTimersByTime(30_000);
    for (let attempt = 0; attempt < 4; attempt++) {
      attempts.recordWrong(1, 7);
    }

    vi.advanceTimersByTime(29_999);
    expect(() => attempts.assertAllowed(1, 7)).toThrow(tooMany);
    vi.advanceTimersByTime(1);
    attempts.assertAllowed(1, 7);

    // A sliding window: the other four still count, so one more is the limit again.
    attempts.recordWrong(1, 7);
    expect(() => attempts.assertAllowed(1, 7)).toThrow(tooMany);
  });

  it('ignores changes to the system clock', () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      attempts.recordWrong(1, 7);
    }

    vi.setSystemTime(Date.now() + 3_600_000);
    expect(() => attempts.assertAllowed(1, 7)).toThrow(tooMany);
    vi.setSystemTime(Date.now() - 7_200_000);
    vi.advanceTimersByTime(UNLOCK_ATTEMPT_WINDOW_MS);
    attempts.assertAllowed(1, 7);
  });

  it('forgets a key\'s attempts after a success and after the window', () => {
    attempts.recordWrong(1, 7);
    attempts.recordWrong(1, 8);
    attempts.recordWrong(2, 9);
    expect(attempts.size).toBe(3);

    attempts.clear(1, 7);
    expect(attempts.size).toBe(2);

    vi.advanceTimersByTime(UNLOCK_ATTEMPT_WINDOW_MS);
    expect(attempts.size).toBe(0);
  });
});
