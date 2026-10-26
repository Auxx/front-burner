/**
 * A one-off message for the login page (LG-9). Pages pass it in the
 * navigation's state, so it is shown once and never ends up in the URL:
 * `router.navigate(['/login'], { state: { loginMessage } })`.
 */
export type LoginMessage = 'logged-out' | 'session-expired' | 'password-reset';
