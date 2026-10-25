import { Test } from '@nestjs/testing';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseModule } from './database.module';
import { openDatabase } from './open-database';

describe('DatabaseModule', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fb-db-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('closes the connection when the application closes', async () => {
    const database = openDatabase(join(dir, 'test.db'));
    const app = (await Test.createTestingModule({ imports: [ DatabaseModule.forRoot(database) ] }).compile())
      .createNestApplication();
    await app.init();
    expect(database.sqlite.open).toBe(true);

    await app.close();

    expect(database.sqlite.open).toBe(false);
  });
});
