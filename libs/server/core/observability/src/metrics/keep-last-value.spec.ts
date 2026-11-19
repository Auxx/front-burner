import { Gauge, Registry } from 'prom-client';
import { metricSample } from '../testing';
import { keepingLastValue } from './keep-last-value';

describe('keepingLastValue', () => {
  it('keeps the last value and warns when the read fails, so that the scrape still answers', async () => {
    const registry = new Registry();
    const logger = { warn: vi.fn() };
    let read = (): number => 3;
    new Gauge({
      name: 'counted',
      help: 'Counted.',
      registers: [ registry ],
      collect: keepingLastValue<Gauge>(logger, 'the things', gauge => gauge.set(read()))
    });
    expect(await metricSample(registry, 'counted')).toBe(3);

    read = () => {
      throw new Error('gone');
    };

    await expect(registry.metrics()).resolves.toContain('counted 3');
    expect(logger.warn).toHaveBeenCalledWith(
      { err: expect.any(Error) },
      'Could not count the things; the metric keeps its last value.'
    );
  });
});
