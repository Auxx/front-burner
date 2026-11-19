import type { Registry } from 'prom-client';

/** One sample of a metric: its labels and value. */
export interface MetricSample {
  labels: Record<string, string | number | undefined>;
  value: number;
}

/**
 * The samples of a metric in the registry. `sample` names one series of a
 * histogram, such as its `_count` or `_sum`; by default, the metric's own.
 */
export async function metricSamples(registry: Registry, name: string, sample = name): Promise<MetricSample[]> {
  const metric = await registry.getSingleMetric(name)?.get();
  // A histogram's samples carry their own name: its buckets, `_sum` and `_count`.
  const values = (metric?.values ?? []) as (MetricSample & { metricName?: string; })[];
  return values.filter(value => (value.metricName ?? name) === sample).map(({ labels, value }) => ({ labels, value }));
}

/** The value of the metric's sample with exactly these labels, or undefined if it has none. */
export async function metricSample(
  registry: Registry,
  name: string,
  labels: Record<string, string> = {},
  sample = name
): Promise<number | undefined> {
  const keyOf = (of: object) => JSON.stringify(Object.entries(of).sort(([ a ], [ b ]) => a.localeCompare(b)));
  return (await metricSamples(registry, name, sample)).find(value => keyOf(value.labels) === keyOf(labels))?.value;
}
