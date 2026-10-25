import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: 'libs/server/core/database/src/schema/index.ts',
  out: 'libs/server/core/database/migrations'
});
