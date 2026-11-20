/**
 * The OpenAPI extension of an operation that `@Public()` or `@AdminOnly()`
 * opens or limits: `public` or `admin`. Operations without it need a login
 * and nothing more. Clients ignore it; the access test reads it (A-7.5).
 */
export const ACCESS_EXTENSION = 'x-front-burner-access';
