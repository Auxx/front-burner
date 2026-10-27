import { OneTimeCodes } from './one-time-codes';

const login = { userId: 7, issuer: 'https://id.example.com', subject: 'subject-1', email: 'ada@example.com' };

describe('OneTimeCodes', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('issues a random code of 32 bytes', () => {
    const codes = new OneTimeCodes();
    const code = codes.issue(login, 'browser-1');
    expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(codes.issue(login, 'browser-1')).not.toBe(code);
  });

  it('uses a code once', () => {
    const codes = new OneTimeCodes();
    const code = codes.issue(login, 'browser-1');
    expect(codes.take(code, 'browser-1')).toEqual(login);
    expect(codes.take(code, 'browser-1')).toBeUndefined();
    expect(codes.take('unknown', 'browser-1')).toBeUndefined();
  });

  it('gives a code only to the browser it was issued to, and burns it', () => {
    const codes = new OneTimeCodes();
    const code = codes.issue(login, 'browser-1');
    expect(codes.take(code, 'browser-2')).toBeUndefined();
    expect(codes.take(code, undefined)).toBeUndefined();
    expect(codes.take(code, 'browser-1')).toBeUndefined();
  });

  it('expires a code after 60 seconds', () => {
    vi.useFakeTimers({ toFake: [ 'Date' ] });
    const codes = new OneTimeCodes();
    const early = codes.issue(login, 'browser-1');
    const late = codes.issue(login, 'browser-1');
    vi.advanceTimersByTime(60_000);
    expect(codes.take(early, 'browser-1')).toEqual(login);
    vi.advanceTimersByTime(1);
    expect(codes.take(late, 'browser-1')).toBeUndefined();
  });
});
