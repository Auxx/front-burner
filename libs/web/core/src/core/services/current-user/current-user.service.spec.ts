import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { CurrentUser } from '@front-burner/shared-contracts';
import { MeApi } from '@front-burner/web-api-client';
import { of, Subject, throwError } from 'rxjs';

import { AuthSessionService } from '../auth-session/auth-session.service';
import { CurrentUserService } from './current-user.service';

const ada: CurrentUser = {
  id: 1,
  email: 'ada@example.com',
  displayName: 'Ada Lovelace',
  role: 'administrator',
  allowedGitLevels: [ 'advanced' ]
};

describe('CurrentUserService', () => {
  let current: ReturnType<typeof vi.fn>;
  let loggedIn: ReturnType<typeof signal<boolean>>;
  let service: CurrentUserService;

  beforeEach(() => {
    current = vi.fn(() => of(ada));
    loggedIn = signal(true);
    TestBed.configureTestingModule({
      providers: [
        { provide: MeApi, useValue: { current } },
        { provide: AuthSessionService, useValue: { loggedIn } }
      ]
    });
    service = TestBed.inject(CurrentUserService);
  });

  it('loads once', async () => {
    expect(service.user()).toBeUndefined();

    expect(await Promise.all([ service.load(), service.load() ])).toEqual([ ada, ada ]);
    expect(await service.load()).toEqual(ada);
    expect(current).toHaveBeenCalledTimes(1);
    expect(service.user()).toEqual(ada);
  });

  it('forgets the user on logout', async () => {
    await service.load();

    loggedIn.set(false);
    TestBed.tick();
    expect(service.user()).toBeUndefined();

    loggedIn.set(true);
    TestBed.tick();
    await service.load();
    expect(current).toHaveBeenCalledTimes(2);
  });

  it('does not cache a failure', async () => {
    current.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 0 })));

    await expect(service.load()).rejects.toBeInstanceOf(HttpErrorResponse);
    expect(await service.load()).toEqual(ada);
  });

  it('ignores a user that arrives after the logout', async () => {
    const answer = new Subject<CurrentUser>();
    current.mockReturnValueOnce(answer);
    const loading = service.load();

    loggedIn.set(false);
    TestBed.tick();
    answer.next(ada);
    answer.complete();
    await loading;

    expect(service.user()).toBeUndefined();
  });
});
