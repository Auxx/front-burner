import { z } from 'zod';

/**
 * A string or `null`. Use this instead of `z.string().nullable()`, whose JSON
 * schema is `type: ['string', 'null']`: `@nestjs/swagger` reads that as an array
 * of strings, and OpenAPI 3.0 has no such type. The spec next to this file checks
 * every schema of this library.
 */
export const nullableString = () => z.string().nullable().meta({ type: 'string', nullable: true });
