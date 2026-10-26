import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';

import { AuthSessionService } from '../../services/auth-session/auth-session.service';
import { authGuard, guestGuard } from './auth.guard';

@Component({ template: '' })
class BlankComponent {}

describe('auth guards', () => {
  async function navigate(loggedIn: boolean, url: string): Promise<string> {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: '', pathMatch: 'full', component: BlankComponent, canActivate: [ authGuard ] },
          { path: 'repositories/:id', component: BlankComponent, canActivate: [ authGuard ] },
          { path: 'login', component: BlankComponent, canActivate: [ guestGuard ] }
        ]),
        { provide: AuthSessionService, useValue: { loggedIn: signal(loggedIn) } }
      ]
    });
    const router = TestBed.inject(Router);
    await router.navigateByUrl(url);
    return router.url;
  }

  it('sends a visitor to the login page with the return target', async () => {
    expect(await navigate(false, '/repositories/3?tab=changes')).toBe(
      `/login?returnUrl=${encodeURIComponent('/repositories/3?tab=changes')}`
    );
  });

  it('sends a visitor from / to the login page', async () => {
    expect(await navigate(false, '/')).toBe('/login?returnUrl=%2F');
  });

  it('lets a logged-in user through', async () => {
    expect(await navigate(true, '/repositories/3')).toBe('/repositories/3');
  });

  it('guestGuard lets a visitor open the login page', async () => {
    expect(await navigate(false, '/login')).toBe('/login');
  });

  it('guestGuard sends a logged-in user home', async () => {
    expect(await navigate(true, '/login?returnUrl=%2Frepositories%2F3')).toBe('/');
  });
});
