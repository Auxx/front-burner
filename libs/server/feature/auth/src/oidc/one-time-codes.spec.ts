import { OneTimeCodes } from './one-time-codes';

const login = { userId: 7, issuer: 'https://id.example.com', subject: 'subject-1', email: 'ada@example.com' };

describe('OneTimeCodes', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('issues a random code of 32 bytes', () => {
    const codes = new OneTimeCodes();
    const code = codes.issue(login);
    expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(codes.issue(login)).not.toBe(code);
  });

  it('uses a code once', () => {
    const codes = new OneTimeCodes();
    const code = codes.issue(login);
    expect(codes.take(code)).toEqual(login);
    expect(codes.take(code)).toBeUndefined();
    expect(codes.take('unknown')).toBeUndefined();
  });

  it('expires a code after 60 seconds', () => {
    vi.useFakeTimers({ toFake: [ 'Date' ] });
    const codes = new OneTimeCodes();
    const early = codes.issue(login);
    const late = codes.issue(login);
    vi.advanceTimersByTime(60_000);
    expect(codes.take(early)).toEqual(login);
    vi.advanceTimersByTime(1);
    expect(codes.take(late)).toBeUndefined();
  });
});
