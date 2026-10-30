import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const projectRoot = join(import.meta.dirname, '..');

function generate(fixture: string, out: string) {
  return spawnSync('npx', [
    'swagger-typescript-api',
    'generate',
    '--path',
    join(projectRoot, 'testing', fixture),
    '--templates',
    join(projectRoot, 'templates'),
    '--output',
    out,
    '--modular',
    '--module-name-first-tag',
    '--silent'
  ], { encoding: 'utf8' });
}

describe('API client generation', () => {
  it('encodes every path parameter into the URL', () => {
    const out = mkdtempSync(join(tmpdir(), 'api-client-'));
    try {
      const result = generate('path-param.openapi.json', out);

      expect(result.status, result.stderr + result.stdout).toBe(0);
      const source = readFileSync(join(out, 'Things.ts'), 'utf8');
      expect(source).toContain('/api/v1/things/${encodeURIComponent(id)}');
      expect(source).not.toContain('things/${id}');
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 30000);

  it('passes query parameters through typed, and sends no body for a body-less POST', () => {
    const out = mkdtempSync(join(tmpdir(), 'api-client-'));
    try {
      const result = generate('query-and-post.openapi.json', out);

      expect(result.status, result.stderr + result.stdout).toBe(0);
      const source = readFileSync(join(out, 'Items.ts'), 'utf8');
      expect(source).toContain('{ params: query }');
      expect(source).not.toContain('as Record');
      expect(source).toContain('query: { tags?: string[]; limit: number }');
      expect(source).toMatch(/this\.http\.request<HealthStatus>\(["']POST["'], `\/api\/v1\/items`\)/);
      expect(source).not.toContain(', null');
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 30000);

  it('skips routes that answer raw bytes', () => {
    const out = mkdtempSync(join(tmpdir(), 'api-client-'));
    try {
      const result = generate('raw-bytes.openapi.json', out);

      expect(result.status, result.stderr + result.stdout).toBe(0);
      const source = readFileSync(join(out, 'Pictures.ts'), 'utf8');
      expect(source).not.toMatch(/\bimage\(/);
      expect(source).toMatch(/\bsummary\(/);
      expect(source).toMatch(/\bremove\(/);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 30000);

  it('fails when a route answers both JSON and raw bytes', () => {
    const out = mkdtempSync(join(tmpdir(), 'api-client-'));
    try {
      const result = generate('mixed-content.openapi.json', out);

      expect(result.status).not.toBe(0);
      expect(result.stderr + result.stdout).toContain('answers both JSON and raw bytes');
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 30000);

  it('fails when a response uses an inline schema instead of a contracts type (A-3.6)', () => {
    const out = mkdtempSync(join(tmpdir(), 'api-client-'));
    try {
      const result = generate('inline-schema.openapi.json', out);

      expect(result.status).not.toBe(0);
      expect(result.stderr + result.stdout).toContain('is not a component schema');
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 30000);
});
