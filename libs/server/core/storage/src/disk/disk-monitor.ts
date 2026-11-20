import { CONFIG, Config } from '@front-burner/server-core-config';
import { Inject, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { stat, statfs } from 'node:fs/promises';

/** The token of the file-system calls the `DiskMonitor` makes; tests replace them. */
export const DISK_PROBE = 'FRONT_BURNER_DISK_PROBE';

/** What `DiskMonitor` reads from the file system. */
export interface DiskProbe {
  /** Free space for an unprivileged process is `bavail * bsize`. */
  statfs(path: string): Promise<{ bavail: number; bsize: number; }>;
  /** The ID of the device, so of the file system, that holds the path. */
  device(path: string): Promise<number>;
}

const NODE_PROBE: DiskProbe = {
  statfs: path => statfs(path),
  device: async path => (await stat(path)).dev
};

/** The volumes the monitor watches: the data directory, and the repositories root when it is another file system. */
export type Volume = 'data' | 'repos';

/**
 * Free bytes per volume at the last reading that worked; `NaN` when there is
 * none yet: before the first check, or while the volume has never been read.
 */
export interface FreeBytes {
  data: number;
  /** Absent when the repositories root is on the data directory's file system. */
  repos?: number;
}

/**
 * Watches free space on the data directory and on the repositories root
 * (NF-9.7). Below `FRONT_BURNER_LOW_DISK_THRESHOLD` on either it is **low**:
 * new clones are refused and readiness is `degraded`; saves, commits and
 * synchronisation go on. Checked once on start and then by the
 * `storage.disk-check` housekeeping job. It publishes no event: storage knows
 * neither users nor sessions, so the banner reads an endpoint _(plan 131's
 * call)_. A volume that cannot be read keeps its last reading, so that a
 * passing failure neither ends nor starts low space; one never read counts as
 * not low, so that a broken check never blocks clones.
 */
@Injectable()
export class DiskMonitor implements OnModuleInit {
  private readonly logger = new Logger(DiskMonitor.name);
  private low = false;
  private free: FreeBytes = { data: Number.NaN };
  /** The volumes whose last read failed, so that a failure is logged once until it works again. */
  private readonly failing = new Set<Volume>();

  constructor(
    @Inject(CONFIG) private readonly config: Pick<Config, 'dataDir' | 'reposRoot' | 'lowDiskThresholdBytes'>,
    @Optional() @Inject(DISK_PROBE) private readonly probe: DiskProbe = NODE_PROBE
  ) {}

  /** Before the instance listens, so that the first readiness answer already knows (NF-9.3). */
  async onModuleInit(): Promise<void> {
    await this.check();
  }

  /** Whether either volume was below the threshold at the last check. */
  isLow(): boolean {
    return this.low;
  }

  /** The free bytes per volume at the last check. */
  freeBytes(): FreeBytes {
    return { ...this.free };
  }

  /** Reads free space and logs when it becomes low (warn) or stops being low (info). Never throws. */
  async check(): Promise<void> {
    const { dataDir, reposRoot, lowDiskThresholdBytes: threshold } = this.config;
    const data = await this.read('data', dataDir);
    this.free = await this.oneFileSystem() ? { data } : { data, repos: await this.read('repos', reposRoot) };

    // NaN, a volume never read, is never below the threshold.
    const low = threshold > 0 && Object.values(this.free).some(bytes => bytes < threshold);
    if (low !== this.low) {
      this.low = low;
      const details = { freeBytes: this.freeBytes(), thresholdBytes: threshold };
      // Both messages are quoted in the deployment guide (docs/wiki/deployment.md): change both together.
      if (low) {
        this.logger.warn(details, 'The server is running low on storage: new clones are refused');
      } else {
        this.logger.log(details, 'The server has enough storage again');
      }
    }
  }

  /** Whether both roots are one file system, so checked once; a device that cannot be read counts as another. */
  private async oneFileSystem(): Promise<boolean> {
    const { dataDir, reposRoot } = this.config;
    if (dataDir === reposRoot) {
      return true;
    }
    try {
      const [ dataDevice, reposDevice ] = await Promise.all([
        this.probe.device(dataDir),
        this.probe.device(reposRoot)
      ]);
      return dataDevice === reposDevice;
    } catch {
      return false;
    }
  }

  private async read(volume: Volume, path: string): Promise<number> {
    try {
      const { bavail, bsize } = await this.probe.statfs(path);
      this.failing.delete(volume);
      return bavail * bsize;
    } catch (error) {
      if (!this.failing.has(volume)) {
        this.failing.add(volume);
        // The path only at debug (NF-10.5).
        this.logger.warn({ volume, errorCode: codeOf(error) }, 'Could not read the free disk space');
        this.logger.debug({ volume, path, err: error }, 'Free disk space failure');
      }
      // The last reading stands, so that a passing failure neither ends nor starts low space.
      return this.free[volume] ?? Number.NaN;
    }
  }
}

function codeOf(error: unknown): string {
  const code = (error as { code?: unknown; } | undefined)?.code;
  return typeof code === 'string' ? code : 'failed';
}
