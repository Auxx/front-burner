import type { FreeBytes } from '@front-burner/server-core-storage';
import { Registry } from 'prom-client';
import { DISK_FREE_BYTES, DiskMetrics } from './disk-metrics';

describe('DiskMetrics', () => {
  let free: FreeBytes;
  let registry: Registry;

  const samples = async () =>
    Object.fromEntries(
      ((await registry.getSingleMetric(DISK_FREE_BYTES)?.get())?.values ?? []).map((
        { labels, value }
      ) => [ String(labels['volume']), value ])
    );

  beforeEach(() => {
    free = { data: Number.NaN };
    registry = new Registry();
    new DiskMetrics({ freeBytes: () => ({ ...free }) }, registry).onModuleInit();
  });

  it('reports free space per volume', async () => {
    free = { data: 5_000_000_000, repos: 7_000_000 };
    expect(await samples()).toEqual({ data: 5_000_000_000, repos: 7_000_000 });

    // The repositories root is now on the data directory's file system.
    free = { data: 4_000_000_000 };
    expect(await samples()).toEqual({ data: 4_000_000_000 });
  });

  it('has no sample for a volume never read', async () => {
    expect(await samples()).toEqual({});

    free = { data: 1_000, repos: Number.NaN };
    expect(await samples()).toEqual({ data: 1_000 });
    expect(await registry.metrics()).not.toContain('NaN');
  });
});
