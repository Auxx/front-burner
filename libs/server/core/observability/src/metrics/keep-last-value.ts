import type { LoggerService } from '@nestjs/common';

/**
 * A gauge's `collect` that updates it from a read made on each scrape. A
 * throw would fail the whole scrape, every other metric with it: when the read
 * fails, the gauge keeps its last value and a warning names `what` it counts.
 */
export function keepingLastValue<G>(
  logger: Pick<LoggerService, 'warn'>,
  what: string,
  update: (gauge: G) => void
): (this: G) => void {
  return function(this: G) {
    try {
      update(this);
    } catch (error) {
      logger.warn({ err: error }, `Could not count ${what}; the metric keeps its last value.`);
    }
  };
}
