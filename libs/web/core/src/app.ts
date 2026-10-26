// What the application shell needs at startup. It is an entry point of its own
// (`@front-burner/web-core/app`) so that the initial bundle does not reach the
// main entry point: modules a lazy feature uses from there, such as
// `toApiError` with the contracts and Zod, would be bundled with the initial
// code (NF-2.9).
export { authGuard, guestGuard } from './core/guards/auth/auth.guard';
export { onboardingGuard } from './core/guards/onboarding/onboarding.guard';
export type { LoginMessage } from './core/models/login-message.model';
export { provideCore } from './core/providers/provide-core';
export { AuthSessionService } from './core/services/auth-session/auth-session.service';
