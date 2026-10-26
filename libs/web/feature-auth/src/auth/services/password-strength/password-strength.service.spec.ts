import { TestBed } from '@angular/core/testing';

import { PasswordStrengthService, ZXCVBN_LOADER } from './password-strength.service';

describe('PasswordStrengthService', () => {
  let service: PasswordStrengthService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(PasswordStrengthService);
  });

  it('rates a long random password 3 or more and password1234 1 or less', async () => {
    expect(await service.estimate('vX7#qL9!mR2$wT', [])).toBeGreaterThanOrEqual(3);
    expect(await service.estimate('password1234', [])).toBeLessThanOrEqual(1);
  });

  it('rates a password made of parts of the email and name lower', async () => {
    const password = 'zqxbrtk.vlmwopa';
    const without = await service.estimate(password, []);
    expect(without).not.toBeNull();
    expect(await service.estimate(password, [ 'zqxbrtk@example.com', 'Vlmwopa' ])).toBeLessThan(without as number);
  });
});

describe('PasswordStrengthService when zxcvbn does not load', () => {
  it('answers null instead of failing, and tries again next time', async () => {
    let calls = 0;
    TestBed.configureTestingModule({
      providers: [
        {
          provide: ZXCVBN_LOADER,
          useValue: async () => {
            calls++;
            if (calls === 1) {
              throw new Error('Failed to fetch dynamically imported module');
            }
            return { check: () => ({ score: 3 }) };
          }
        }
      ]
    });
    const service = TestBed.inject(PasswordStrengthService);

    expect(await service.estimate('violet staircase 42', [])).toBeNull();
    expect(await service.estimate('violet staircase 42', [])).toBe(3);
    expect(calls).toBe(2);
  });
});
