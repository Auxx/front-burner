import { DiskMonitor, type FreeBytes } from '@front-burner/server-core-storage';
import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { Gauge, Registry } from 'prom-client';
import { METRICS_PREFIX, METRICS_REGISTRY } from '../metrics/metrics-registry';

export const DISK_FREE_BYTES = `${METRICS_PREFIX}disk_free_bytes`;

/**
 * `front_burner_disk_free_bytes{volume}` (NF-10.11): the free bytes of each
 * volume at the disk monitor's last check (NF-9.7), `data` and, when the
 * repositories root is another file system, `repos`. A volume never read has
 * no sample rather than `NaN`. It lives here rather than in the storage
 * library, which the metrics registry's library already depends on.
 */
@Injectable()
export class DiskMetrics implements OnModuleInit {
  constructor(
    @Inject(DiskMonitor) private readonly disk: Pick<DiskMonitor, 'freeBytes'>,
    @Inject(METRICS_REGISTRY) private readonly registry: Registry
  ) {}

  onModuleInit(): void {
    const freeBytes = (): FreeBytes => this.disk.freeBytes();
    new Gauge({
      name: DISK_FREE_BYTES,
      help: 'Free bytes on each volume (data, repos) at the last disk check.',
      labelNames: [ 'volume' ] as const,
      registers: [ this.registry ],
      collect() {
        // A volume that stops being its own, or was never read, loses its sample.
        this.reset();
        for (const [ volume, bytes ] of Object.entries(freeBytes())) {
          if (Number.isFinite(bytes)) {
            this.set({ volume }, bytes);
          }
        }
      }
    });
  }
}
