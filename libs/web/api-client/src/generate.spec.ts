import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const projectRoot = join(import.meta.dirname, '..');

describe('API client generation', () => {
  it('fails when a response uses an inline schema instead of a contracts type (A-3.6)', () => {
    const out = mkdtempSync(join(tmpdir(), 'api-client-'));
    try {
      const result = spawnSync('npx', [
        'swagger-typescript-api',
        'generate',
        '--path',
        join(projectRoot, 'testing/inline-schema.openapi.json'),
        '--templates',
        join(projectRoot, 'templates'),
        '--output',
        out,
        '--modular',
        '--module-name-first-tag',
        '--silent'
      ], { encoding: 'utf8' });

      expect(result.status).not.toBe(0);
      expect(result.stderr + result.stdout).toContain('is not a component schema');
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 30000);
});
