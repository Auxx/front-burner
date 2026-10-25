import { config } from 'zod';

// Zod's default parser is compiled with `new Function`, which the CSP and
// Trusted Types forbid (NF-11.1). Import this module first in `main.ts`, so
// it runs before any schema is created.
config({ jitless: true });
