// Zod's default parser is compiled with `new Function`, which the CSP and
// Trusted Types forbid (NF-11.1). Zod reads its configuration from this global
// when a schema is created, so it is set in a polyfill: polyfills run before
// the main bundle, whatever order the bundler gives the modules inside it.
// Calling Zod's `config()` from `main.ts` was not enough: the bundler placed
// the shared contracts' schemas before that call.
const scope = globalThis as { __zod_globalConfig?: Record<string, unknown>; };
scope.__zod_globalConfig = { ...scope.__zod_globalConfig, jitless: true };

export {};
