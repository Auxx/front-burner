// What the application shell needs at startup. It is an entry point of its own
// (`@front-burner/web-core/app`) so that the initial bundle does not reach the
// main entry point: modules a lazy feature uses from there, such as
// `toApiError` with the contracts and Zod, would be bundled with the initial
// code (NF-2.9).
export { onboardingGuard } from './core/guards/onboarding/onboarding.guard';
export { provideCore } from './core/providers/provide-core';
