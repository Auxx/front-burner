import { Logger } from '@nestjs/common';
import { DiskMonitor, DiskProbe } from './disk-monitor';

const GB = 1024 ** 3;
const DATA = '/data';
const REPOS = '/repos';

/** A probe whose free space and devices the tests set; free space in bytes, as `bavail * bsize`. */
function fakeProbe(free: Record<string, number | Error>, devices: Record<string, number> = { [DATA]: 1, [REPOS]: 2 }) {
  const probe = {
    free,
    statfs: vi.fn((path: string) => {
      const value = probe.free[path];
      return value instanceof Error
        ? Promise.reject(value)
        : Promise.resolve({ bavail: value / 4096, bsize: 4096 });
    }),
    device: vi.fn((path: string) => Promise.resolve(devices[path]))
  };
  return probe satisfies DiskProbe;
}

describe('DiskMonitor', () => {
  let warn: ReturnType<typeof vi.spyOn>;
  let log: ReturnType<typeof vi.spyOn>;

  const monitor = (probe: DiskProbe, options: { threshold?: number; reposRoot?: string; } = {}) =>
    new DiskMonitor(
      { dataDir: DATA, reposRoot: options.reposRoot ?? REPOS, lowDiskThresholdBytes: options.threshold ?? 2 * GB },
      probe
    );

  beforeEach(() => {
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is not low and knows no free space before the first check', () => {
    const disks = monitor(fakeProbe({ [DATA]: GB, [REPOS]: GB }));
    expect(disks.isLow()).toBe(false);
    expect(disks.freeBytes().data).toBeNaN();
  });

  it('above the threshold is not low', async () => {
    const disks = monitor(fakeProbe({ [DATA]: 10 * GB, [REPOS]: 20 * GB }));
    await disks.check();
    expect(disks.isLow()).toBe(false);
    expect(disks.freeBytes()).toEqual({ data: 10 * GB, repos: 20 * GB });
  });

  it('below the threshold is low', async () => {
    const disks = monitor(fakeProbe({ [DATA]: GB, [REPOS]: GB }));
    await disks.check();
    expect(disks.isLow()).toBe(true);
  });

  it('exactly the threshold is not low', async () => {
    const disks = monitor(fakeProbe({ [DATA]: 2 * GB, [REPOS]: 2 * GB }));
    await disks.check();
    expect(disks.isLow()).toBe(false);
  });

  it('either volume below the threshold is low', async () => {
    const reposLow = monitor(fakeProbe({ [DATA]: 10 * GB, [REPOS]: GB }));
    await reposLow.check();
    expect(reposLow.isLow()).toBe(true);

    const dataLow = monitor(fakeProbe({ [DATA]: GB, [REPOS]: 10 * GB }));
    await dataLow.check();
    expect(dataLow.isLow()).toBe(true);
  });

  it('one file system is checked once', async () => {
    const probe = fakeProbe({ [DATA]: 5 * GB, [REPOS]: 5 * GB }, { [DATA]: 7, [REPOS]: 7 });
    const disks = monitor(probe);
    await disks.check();
    expect(probe.statfs).toHaveBeenCalledTimes(1);
    expect(probe.statfs).toHaveBeenCalledWith(DATA);
    expect(disks.freeBytes()).toEqual({ data: 5 * GB });
  });

  it('the data directory as the repositories root is checked once, without comparing devices', async () => {
    const probe = fakeProbe({ [DATA]: 5 * GB });
    const disks = monitor(probe, { reposRoot: DATA });
    await disks.check();
    expect(probe.statfs).toHaveBeenCalledTimes(1);
    expect(probe.device).not.toHaveBeenCalled();
    expect(disks.freeBytes()).toEqual({ data: 5 * GB });
  });

  it('a failed statfs is not low', async () => {
    const disks = monitor(fakeProbe({ [DATA]: Object.assign(new Error('EIO'), { code: 'EIO' }), [REPOS]: 10 * GB }));
    await disks.check();
    expect(disks.isLow()).toBe(false);
    expect(disks.freeBytes().data).toBeNaN();
    expect(warn).toHaveBeenCalledWith({ volume: 'data', errorCode: 'EIO' }, 'Could not read the free disk space');
  });

  it('a failed statfs keeps the volume\'s last reading, so low space stays low', async () => {
    const probe = fakeProbe({ [DATA]: GB, [REPOS]: 10 * GB });
    const disks = monitor(probe);
    await disks.check();
    expect(disks.isLow()).toBe(true);

    probe.free = { [DATA]: Object.assign(new Error('EIO'), { code: 'EIO' }), [REPOS]: 10 * GB };
    await disks.check();
    expect(disks.isLow()).toBe(true);
    expect(disks.freeBytes()).toEqual({ data: GB, repos: 10 * GB });
    expect(log).not.toHaveBeenCalled();
  });

  it('a failed statfs keeps enough space as enough', async () => {
    const probe = fakeProbe({ [DATA]: 10 * GB, [REPOS]: 10 * GB });
    const disks = monitor(probe);
    await disks.check();

    probe.free = { [DATA]: new Error('EIO'), [REPOS]: 10 * GB };
    await disks.check();
    expect(disks.isLow()).toBe(false);
    expect(disks.freeBytes().data).toBe(10 * GB);
  });

  it('logs a failed statfs once until it works again', async () => {
    const probe = fakeProbe({ [DATA]: new Error('EIO'), [REPOS]: 10 * GB });
    const disks = monitor(probe);
    await disks.check();
    await disks.check();
    expect(warn).toHaveBeenCalledTimes(1);

    probe.free = { [DATA]: 10 * GB, [REPOS]: 10 * GB };
    await disks.check();
    probe.free = { [DATA]: new Error('EIO'), [REPOS]: 10 * GB };
    await disks.check();
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('a device that cannot be read counts as another file system', async () => {
    const probe = fakeProbe({ [DATA]: 10 * GB, [REPOS]: GB });
    probe.device.mockRejectedValue(new Error('ENOENT'));
    const disks = monitor(probe);
    await disks.check();
    expect(disks.isLow()).toBe(true);
  });

  it('a threshold of 0 is never low, but still measures', async () => {
    const disks = monitor(fakeProbe({ [DATA]: 0, [REPOS]: 0 }), { threshold: 0 });
    await disks.check();
    expect(disks.isLow()).toBe(false);
    expect(disks.freeBytes()).toEqual({ data: 0, repos: 0 });
  });

  it('logs once on entering and once on leaving', async () => {
    const probe = fakeProbe({ [DATA]: GB, [REPOS]: 10 * GB });
    const disks = monitor(probe);
    await disks.check();
    await disks.check();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      { freeBytes: { data: GB, repos: 10 * GB }, thresholdBytes: 2 * GB },
      'The server is running low on storage: new clones are refused'
    );

    probe.free = { [DATA]: 10 * GB, [REPOS]: 10 * GB };
    await disks.check();
    await disks.check();
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(
      { freeBytes: { data: 10 * GB, repos: 10 * GB }, thresholdBytes: 2 * GB },
      'The server has enough storage again'
    );
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('leaving low space clears it', async () => {
    const probe = fakeProbe({ [DATA]: GB, [REPOS]: GB });
    const disks = monitor(probe);
    await disks.check();
    expect(disks.isLow()).toBe(true);

    probe.free = { [DATA]: 3 * GB, [REPOS]: 3 * GB };
    await disks.check();
    expect(disks.isLow()).toBe(false);
  });

  it('checks once on start', async () => {
    const probe = fakeProbe({ [DATA]: GB, [REPOS]: GB });
    const disks = monitor(probe);
    await disks.onModuleInit();
    expect(disks.isLow()).toBe(true);
  });
});
