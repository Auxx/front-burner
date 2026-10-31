import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { CurrentUser } from '@front-burner/shared-contracts';
import { CurrentUserService } from '@front-burner/web-core';

import { EditorSettingsService } from './editor-settings.service';

describe('EditorSettingsService', () => {
  let service: EditorSettingsService;
  let user: ReturnType<typeof signal<CurrentUser | undefined>>;

  const signedIn = (id: number) => ({ id, email: `u${id}@example.com` }) as unknown as CurrentUser;

  beforeEach(() => {
    user = signal<CurrentUser | undefined>(signedIn(1));
    TestBed.configureTestingModule({ providers: [ { provide: CurrentUserService, useValue: { user } } ] });
    service = TestBed.inject(EditorSettingsService);
    TestBed.tick();
  });

  it('wraps long lines at first', () => {
    expect(service.softWrap()).toBe(true);
  });

  it('keeps the choice, for every consumer', () => {
    service.softWrap.set(false);
    TestBed.tick();
    expect(TestBed.inject(EditorSettingsService)).toBe(service);
    expect(TestBed.inject(EditorSettingsService).softWrap()).toBe(false);
  });

  it('keeps the choice while the same user stays signed in', () => {
    service.softWrap.set(false);
    user.set(signedIn(1));
    TestBed.tick();
    expect(service.softWrap()).toBe(false);
  });

  it('wraps again when another user signs in', () => {
    service.softWrap.set(false);
    user.set(signedIn(2));
    TestBed.tick();
    expect(service.softWrap()).toBe(true);
  });
});
