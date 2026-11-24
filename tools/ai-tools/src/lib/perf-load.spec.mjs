import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import {
  backendPid,
  cgroupPathOf,
  cpuSplit,
  eventLoopDelay,
  jobRunTimes,
  loadLines,
  maxQueued,
  metricSum,
  parseCpuStat,
  parseMetrics,
  parsePidStat,
  parseProcStat,
  readCpu,
  startLoadRecorder
} from './perf-load.mjs';

const exposition = (pullCount, pullSum, extra = '') =>
  [
    '# HELP front_burner_job_duration_seconds Duration.',
    '# TYPE front_burner_job_duration_seconds histogram',
    `front_burner_job_duration_seconds_bucket{le="1",type="sync.pull",result="done"} ${pullCount}`,
    `front_burner_job_duration_seconds_sum{type="sync.pull",result="done"} ${pullSum}`,
    `front_burner_job_duration_seconds_count{type="sync.pull",result="done"} ${pullCount}`,
    'front_burner_job_duration_seconds_sum{type="sync.push",result="done"} 2',
    'front_burner_job_duration_seconds_count{type="sync.push",result="done"} 4',
    'front_burner_jobs_queued{type="sync.pull"} 0',
    extra,
    ''
  ].join('\n');

describe('parseMetrics', () => {
  it('reads names, labels and values, and skips comments', () => {
    const samples = parseMetrics(
      '# HELP x y\nfront_burner_up 1\nfront_burner_http{route="/a \\"b\\"",method="GET"} 2.5 1700000000\n\n'
    );
    expect(samples).toEqual([
      { name: 'front_burner_up', labels: {}, value: 1 },
      { name: 'front_burner_http', labels: { route: '/a "b"', method: 'GET' }, value: 2.5 }
    ]);
    expect(metricSum(samples, 'front_burner_http', { method: 'GET' })).toBe(2.5);
    expect(metricSum(samples, 'front_burner_http', { method: 'PUT' })).toBe(0);
  });

  it('throws on a line it cannot read', () => {
    expect(() => parseMetrics('front_burner_up\n')).toThrow(/Line 1/);
  });
});

describe('jobRunTimes', () => {
  it('gives the runs and mean run time of the jobs that ended between two scrapes', () => {
    const before = parseMetrics(exposition(10, 5));
    const after = parseMetrics(exposition(14, 7.4));
    expect(jobRunTimes(before, after)).toEqual({ 'sync.pull': { runs: 4, meanMs: expect.closeTo(600, 6) } });
  });
});

describe('the CPU counters', () => {
  it('reads /proc/stat, /proc/<pid>/stat, the cgroup and its cpu.stat', () => {
    expect(parseProcStat('cpu  100 0 50 800 50 0 0 0 0 0\ncpu0 1 2 3 4\n')).toEqual({ busy: 1.5, total: 10 });
    // A name with spaces and parentheses: fields count from the last `)`.
    const stat = `42 (node (main) x) S 1 42 42 0 -1 4194560 100 0 0 0 250 150 7 3 20 0 11 0 100`;
    expect(parsePidStat(stat)).toBe(4);
    expect(cgroupPathOf('0::/system.slice/docker-abc.scope\n')).toBe('/system.slice/docker-abc.scope');
    expect(() => cgroupPathOf('1:name=systemd:/\n')).toThrow(/cgroup v2/);
    expect(parseCpuStat('usage_usec 2500000\nuser_usec 1\n')).toBe(2.5);
  });

  it('splits the CPU into the instance\'s process, the rest of its container and the rest of the host', () => {
    const files = {
      '/proc/stat': 'cpu  0 0 0 0 0 0 0 0\n',
      '/proc/7/cgroup': '0::/c\n',
      '/proc/7/stat': '7 (node) S 1 1 1 0 -1 0 0 0 0 0 0 0 0 0',
      '/sys/fs/cgroup/c/cpu.stat': 'usage_usec 0\n'
    };
    const first = { ...readCpu(7, path => files[path]), at: 0 };
    expect(readCpu(undefined, path => files[path]).node).toBeUndefined();
    const last = { at: 10_000, host: { busy: 15, total: 20 }, node: 8, container: 12 };
    expect(cpuSplit(first, last)).toEqual({
      seconds: 10,
      host: 1.5,
      node: 0.8,
      instanceOther: expect.closeTo(0.4),
      rest: expect.closeTo(0.3)
    });
    expect(cpuSplit({ ...first, node: undefined }, last)).toEqual({ seconds: 10, host: 1.5 });
  });
});

describe('backendPid', () => {
  it('takes the child of the image\'s init, or the process itself without one', () => {
    const files = {
      '/proc/10/comm': 'tini\n',
      '/proc/10/task/10/children': '11 ',
      '/proc/20/comm': 'MainThread\n',
      '/proc/30/comm': 'tini\n',
      '/proc/30/task/30/children': '31 32 '
    };
    const read = path => files[path];
    expect(backendPid(10, read)).toBe(11);
    expect(backendPid(20, read)).toBe(20);
    expect(() => backendPid(30, read)).toThrow(/2 children/);
  });
});

describe('eventLoopDelay and maxQueued', () => {
  it('summarises the windows after the first scrape', () => {
    const window = (p50, p99, max, queued) =>
      parseMetrics(
        `front_burner_nodejs_eventloop_lag_p50_seconds ${p50}\nfront_burner_nodejs_eventloop_lag_p99_seconds ${p99}\n`
          + `front_burner_nodejs_eventloop_lag_max_seconds ${max}\nfront_burner_jobs_queued{type="sync.pull"} ${queued}\n`
      );
    const scrapes = [ window(1, 1, 1, 0), window(0.01, 0.05, 0.1, 3), window(0.03, 0.02, 0.2, 5) ];
    const delay = eventLoopDelay(scrapes);
    expect(delay.p50).toBeCloseTo(20);
    expect(delay.p99).toBeCloseTo(50);
    expect(delay.max).toBeCloseTo(200);
    expect(maxQueued(scrapes)).toEqual({ 'sync.pull': 5 });
    expect(eventLoopDelay([ window(1, 1, 1, 0) ])).toBeUndefined();
  });
});

describe('startLoadRecorder', () => {
  it('scrapes with the token until stopped, and summarises', async () => {
    let scrapes = 0;
    const tokens = new Set();
    const server = createServer((request, response) => {
      tokens.add(request.headers.authorization);
      scrapes++;
      response.end(exposition(10 + scrapes, 5 + scrapes * 0.5));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const recorder = await startLoadRecorder({
        url: `http://127.0.0.1:${server.address().port}/`,
        token: 'secret',
        everyMs: 20
      });
      await new Promise(resolve => setTimeout(resolve, 70));
      const summary = await recorder.stop();
      expect(tokens).toEqual(new Set([ 'Bearer secret' ]));
      expect(summary.scrapes.length).toBe(scrapes);
      expect(summary.jobs['sync.pull']).toEqual({ runs: scrapes - 1, meanMs: expect.closeTo(500, 6) });
      expect(summary.cpu.node).toBeUndefined();
      const lines = loadLines(summary, { 'sync.pull': 800 });
      expect(lines.join('\n')).toMatch(/Job sync.pull: \d+ run, mean run time 500 ms; .* 800 ms, so 300 ms waiting/);
    } finally {
      server.close();
    }
  });

  it('fails when the instance refuses the token', async () => {
    const server = createServer((_request, response) => {
      response.statusCode = 401;
      response.end();
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      await expect(startLoadRecorder({ url: `http://127.0.0.1:${server.address().port}`, token: 'x' })).rejects
        .toThrow(/401/);
    } finally {
      server.close();
    }
  });
});
