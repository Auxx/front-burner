/**
 * The `sessionStorage` key of the page to return to after an OIDC login: the
 * login page stores it before leaving for the provider, and the page that
 * finishes the login reads and removes it.
 */
export const OIDC_RETURN_KEY = 'front-burner.oidc-return';
