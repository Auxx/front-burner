import { describe, expect, it } from 'vitest';
import { createSseParser, parseServerTiming, percentile, resultRows, resultTable, summarise } from './perf-stats.mjs';

describe('percentile', () => {
  it('takes the nearest rank', () => {
    const values = Array.from({ length: 100 }, (_, i) => 100 - i);
    expect(percentile(values, 95)).toBe(95);
    expect(percentile(values, 50)).toBe(50);
    expect(percentile([ 7 ], 95)).toBe(7);
    expect(percentile([ 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 ], 95)).toBe(10);
    expect(percentile([], 95)).toBeUndefined();
  });

  it('summarises runs, p50, p95 and max', () => {
    expect(summarise([ 3, 1, 2 ])).toEqual({ runs: 3, p50: 2, p95: 3, max: 3 });
  });
});

describe('parseServerTiming', () => {
  it('reads app;dur in milliseconds', () => {
    expect(parseServerTiming('app;dur=12.3')).toBe(12.3);
    expect(parseServerTiming('cache;desc="hit", app;dur=4')).toBe(4);
    expect(parseServerTiming('app')).toBeUndefined();
    expect(parseServerTiming('db;dur=3')).toBeUndefined();
    expect(parseServerTiming(null)).toBeUndefined();
  });
});

describe('createSseParser', () => {
  it('gives each complete event, across chunks, and skips comments', () => {
    const events = [];
    const parse = createSseParser(event => events.push(event));
    parse(': connected\n\nevent: job.finished\ndata: {"jobId":');
    expect(events).toEqual([]);
    parse('3}\n\n: keep-alive\n\nevent: git.changed\r\ndata: {}\r\n\r\n');
    expect(events).toEqual([
      { event: 'job.finished', data: '{"jobId":3}' },
      { event: 'git.changed', data: '{}' }
    ]);
  });
});

describe('resultRows', () => {
  it('passes a server row whose p95 is within its target', () => {
    const rows = resultRows({ folder: [ 100, 200, 310 ], file: [ 10 ] });
    expect(rows.map(row => [ row.rule, row.p95, row.pass ])).toEqual([ [ 'NF-2.1', 310, false ], [
      'NF-2.2',
      10,
      true
    ] ]);
  });

  it('takes plain git\'s median from a job row (NF-2.6)', () => {
    const [ pull ] = resultRows({ pull: [ 1500, 1600, 2400 ] }, { pull: [ 1000, 1100, 5000 ] });
    expect(pull).toMatchObject({ jobP95: 2400, gitP50: 1100, p50: 500, p95: 1300, max: 1300, pass: false });
    expect(() => resultRows({ push: [ 10 ] })).toThrow(/baseline/);
  });

  it('prints a row per operation with its target', () => {
    const table = resultTable(resultRows({ push: [ 300 ], 'status-warm': [ 1200 ] }, { push: [ 100 ] }));
    expect(table[0]).toEqual([ 'Rule', 'Operation', 'Runs', 'p50', 'p95', 'Max', 'Target', 'Pass' ]);
    expect(table[1]).toEqual([
      'NF-2.6',
      'Push (job) over git push',
      '1',
      '200 ms',
      '200 ms',
      '200 ms',
      '≤ 1000 ms added (job p95 300 ms, git p50 100 ms)',
      'yes'
    ]);
    expect(table[2].slice(6)).toEqual([ '≈ 2000 ms', 'yes' ]);
  });

  it('shows a row without a target as information only (NF-1.4)', () => {
    const [ row ] = resultRows({ 'push-large': [ 9000 ] });
    expect(row.pass).toBe(true);
    expect(resultTable([ row ])[1].slice(6)).toEqual([ '—', '—' ]);
  });
});
