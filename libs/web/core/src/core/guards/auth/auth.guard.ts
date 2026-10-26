import { inject } from '@angular/core';
import { type CanActivateFn, Router } from '@angular/router';

import { AuthSessionService } from '../../services/auth-session/auth-session.service';

/** Sends a visitor to the login page and remembers the page they asked for (LG-4, NV-2, DS-1). */
export const authGuard: CanActivateFn = (_route, state) =>
  inject(AuthSessionService).loggedIn()
  || inject(Router).createUrlTree([ '/login' ], { queryParams: { returnUrl: state.url } });

/** Sends a logged-in user from the login page to the home page (LG-3). */
export const guestGuard: CanActivateFn = () => !inject(AuthSessionService).loggedIn() || inject(Router).parseUrl('/');
