import type { INestApplication } from '@nestjs/common';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from './start-server';
import { writeOpenApi } from './write-openapi';

describe('writeOpenApi', () => {
  let root: string;
  let app: INestApplication;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'fb-openapi-'));
    app = await startServer({
      env: { FRONT_BURNER_DATA_DIR: join(root, 'data'), FRONT_BURNER_LOG_LEVEL: 'error' },
      cwd: root,
      webRoot: join(root, 'web'),
      migrationsFolder: join(root, 'migrations'),
      listen: false,
      logDestination: { write: () => undefined }
    });
  });

  afterEach(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('writes the document of the running application', () => {
    const file = join(root, 'openapi.json');

    writeOpenApi(app, file);

    const text = readFileSync(file, 'utf8');
    expect(text.endsWith('}\n')).toBe(true);
    const document = JSON.parse(text);
    const operations = Object.values(document.paths).flatMap((p: any) => Object.values(p) as any[]);
    expect(operations.map(o => o.operationId)).toEqual(expect.arrayContaining([ 'live', 'ready' ]));
    expect(operations.every(o => o.tags.includes('health'))).toBe(true);
    expect(document.components.schemas).toHaveProperty('HealthStatus');
  });

  it('is byte-stable across runs', () => {
    const first = join(root, 'one.json');
    const second = join(root, 'two.json');

    writeOpenApi(app, first);
    writeOpenApi(app, second);

    expect(readFileSync(second, 'utf8')).toBe(readFileSync(first, 'utf8'));
  });
});
