# web-core

What every page of the web client needs (A-2): HTTP, Transloco with the ICU
transpiler, page titles and the translation of API errors, wired up by
`provideCore()`, and the onboarding guard and state.

`apps/web` imports from `@front-burner/web-core/app` (`src/app.ts`), which
exports only what the shell needs at startup; features import from
`@front-burner/web-core`. Everything the initial code can reach through the main
entry point would land in the initial bundle (A-8.1).

Tested with Vitest and Angular's TestBed: `nx test web-core`.
