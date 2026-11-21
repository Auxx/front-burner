import { describe, expect, it } from 'vitest';
import {
  allPass,
  createSseParser,
  jobProblem,
  parseServerTiming,
  percentile,
  resultRows,
  resultTable,
  retryAfterMs,
  summarise
} from './perf-stats.mjs';

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

  it('shows a soft target that is over as "over", and fails only on hard targets', () => {
    const over = resultRows({ 'status-warm': [ 2500 ], file: [ 10 ] });
    expect(resultTable(over)[2].slice(6)).toEqual([ '≈ 2000 ms', 'over' ]);
    expect(allPass(over)).toBe(true);
    expect(allPass(resultRows({ 'status-warm': [ 2500 ], file: [ 250 ] }))).toBe(false);
  });
});

describe('retryAfterMs', () => {
  const now = Date.parse('2026-11-21T12:00:00Z');

  it('reads seconds or an HTTP date', () => {
    expect(retryAfterMs('7', now)).toBe(7000);
    expect(retryAfterMs('Sat, 21 Nov 2026 12:00:03 GMT', now)).toBe(3000);
  });

  it('never gives a wait of nothing', () => {
    expect(retryAfterMs('0', now)).toBe(250);
    expect(retryAfterMs('Sat, 21 Nov 2026 11:00:00 GMT', now)).toBe(250);
    expect(retryAfterMs('soon', now)).toBe(1000);
    expect(retryAfterMs(null, now)).toBe(1000);
  });
});

describe('jobProblem', () => {
  it('accepts a push that pushed and a pull that pulled without a conflict', () => {
    expect(jobProblem('/git/push', { status: 'done', outcome: { kind: 'pushed' } })).toBeUndefined();
    expect(jobProblem('/git/pull', { status: 'done', outcome: { kind: 'pulled', result: 'fast-forward' } }))
      .toBeUndefined();
  });

  it('refuses a job that was cancelled, failed, or pulled into a conflict', () => {
    expect(jobProblem('/git/push', { status: 'cancelled', outcome: null })).toMatch(/ended cancelled/);
    expect(jobProblem('/git/push', { status: 'done', outcome: { kind: 'failed', code: 'rejected' } })).toMatch(
      /did not succeed/
    );
    expect(jobProblem('/git/pull', { status: 'done', outcome: { kind: 'pulled', result: 'conflicted' } })).toMatch(
      /conflicted/
    );
  });
});
