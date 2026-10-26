# web-feature-auth

The web client's authentication feature (A-2): the Administrator onboarding page
(REQ-AUTH-001, username + password path) and the login page, later password
reset. Loaded lazily from the `authRoutes`. The `@zxcvbn-ts` packages of the
password strength meter load on first use, in chunks of their own.

Tested with Vitest and Angular's TestBed: `nx test web-feature-auth`. Specs
render translation keys instead of English texts (`src/testing`); the web
application's `translations.spec.ts` checks the texts.
