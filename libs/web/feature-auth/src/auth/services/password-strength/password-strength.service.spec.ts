import { TestBed } from '@angular/core/testing';

import { PasswordStrengthService } from './password-strength.service';

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
    expect(await service.estimate(password, [ 'zqxbrtk@example.com', 'Vlmwopa' ])).toBeLessThan(
      await service.estimate(password, [])
    );
  });
});
