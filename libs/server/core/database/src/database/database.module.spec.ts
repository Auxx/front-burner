import { Test } from '@nestjs/testing';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseModule } from './database.module';
import { openDatabase } from './open-database';

describe('DatabaseModule', () => {
  it('closes the connection when the application closes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fb-db-'));
    const database = openDatabase(join(dir, 'test.db'));
    const app = (await Test.createTestingModule({ imports: [ DatabaseModule.forRoot(database) ] }).compile())
      .createNestApplication();
    await app.init();
    expect(database.sqlite.open).toBe(true);

    await app.close();

    expect(database.sqlite.open).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });
});
