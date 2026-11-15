import { defineConfig } from 'drizzle-kit';

// Paths are relative to this folder: `db-generate` runs drizzle-kit here, so
// that it reads this library's tsconfig.json and resolves the workspace's path
// aliases, which the schema files import.
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/schema/index.ts',
  out: './migrations'
});
