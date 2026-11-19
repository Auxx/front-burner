import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The deployment guide quotes its compose example, which the container suite
 * starts (`container.e2e.spec.ts`). This check needs neither Docker nor a
 * server, so CI's `lint` job runs it on every change (`npm run check:guide`),
 * including one that changes only the guide.
 */
describe('the deployment guide', () => {
  it('quotes the compose example as it is', () => {
    const wiki = resolve(import.meta.dirname, '../../../docs/wiki');
    const example = readFileSync(join(wiki, 'compose.example.yaml'), 'utf8');
    const guide = readFileSync(join(wiki, 'deployment.md'), 'utf8');

    expect(guide).toContain('```yaml\n' + example + '```\n');
  });
});
