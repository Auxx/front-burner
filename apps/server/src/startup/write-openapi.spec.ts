import type { INestApplication } from '@nestjs/common';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from './start-server';
import { writeOpenApi } from './write-openapi';

// The real migrations: the application needs its tables.
const MIGRATIONS = join(__dirname, '..', '..', '..', '..', 'libs', 'server', 'core', 'database', 'migrations');

describe('writeOpenApi', () => {
  let root: string;
  let app: INestApplication;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'fb-openapi-'));
    app = await startServer({
      env: {
        FRONT_BURNER_DATA_DIR: join(root, 'data'),
        FRONT_BURNER_LOG_LEVEL: 'error',
        FRONT_BURNER_JWT_SECRET: 'server-spec-jwt-secret-0123456789abcdefghijklm'
      },
      cwd: root,
      webRoot: join(root, 'web'),
      migrationsFolder: MIGRATIONS,
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
    expect(operations.map(o => o.operationId)).toEqual(
      expect.arrayContaining([ 'live', 'ready', 'status', 'checkSetupToken', 'setUpPassword' ])
    );
    // The client is generated one class per tag.
    expect(operations.every(o => o.tags.length === 1)).toBe(true);
    expect(document.components.schemas).toHaveProperty('HealthStatus');
    expect(document.components.schemas).toHaveProperty('PasswordSetupRequest');
  });

  it('is byte-stable across runs', () => {
    const first = join(root, 'one.json');
    const second = join(root, 'two.json');

    writeOpenApi(app, first);
    writeOpenApi(app, second);

    expect(readFileSync(second, 'utf8')).toBe(readFileSync(first, 'utf8'));
  });
});
