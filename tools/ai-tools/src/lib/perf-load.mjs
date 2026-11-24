/**
 * What the instance's host does during a `perf-api.mjs run` (plan 160): the
 * instance's `/api/metrics` (job run times, the event loop's delay) and CPU
 * time by where it went: the instance's Node.js process, the rest of its
 * container (its git), and the rest of the host (the tool, its git server).
 * The parsers are pure; `startLoadRecorder` reads `/proc` and `/sys/fs/cgroup`,
 * so the CPU split needs Linux and the instance on the same host.
 */
import { readFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { performance } from 'node:perf_hooks';

/** Clock ticks per second of `/proc/<pid>/stat`; 100 on every Linux the tools run on. */
const CLOCK_TICKS = 100;

/**
 * The samples of a Prometheus text exposition: `{ name, labels, value }`.
 * Comments and blank lines are skipped; any other line it cannot read throws.
 */
export function parseMetrics(text) {
  const samples = [];
  for (const [ index, line ] of text.split('\n').entries()) {
    if (line.trim() === '' || line.startsWith('#')) {
      continue;
    }
    const match = /^([a-zA-Z_:][\w:]*)(?:\{(.*)\})?\s+(\S+)(?:\s+\d+)?$/.exec(line);
    if (!match) {
      throw new Error(`Line ${index + 1} of the metrics is not a sample: ${line}`);
    }
    const labels = {};
    for (const [ , name, value ] of (match[2] ?? '').matchAll(/(\w+)="((?:[^"\\]|\\.)*)"/g)) {
      labels[name] = value.replace(/\\(.)/g, (_, c) => (c === 'n' ? '\n' : c));
    }
    samples.push({ name: match[1], labels, value: Number(match[3]) });
  }
  return samples;
}

/** The sum of the samples called `name` whose labels include `labels`. */
export function metricSum(samples, name, labels = {}) {
  return samples
    .filter(sample =>
      sample.name === name && Object.entries(labels).every(([ key, value ]) => sample.labels[key] === value)
    )
    .reduce((total, sample) => total + sample.value, 0);
}

/**
 * Job attempts that ended between two scrapes, by job type: how many, and
 * their mean run time in milliseconds (from the handler's call to its end,
 * A-6.6), whatever their result. Types with none are left out.
 */
export function jobRunTimes(before, after, prefix = 'front_burner_') {
  const types = new Set(
    after.filter(sample => sample.name === `${prefix}job_duration_seconds_count`).map(sample => sample.labels.type)
  );
  const result = {};
  for (const type of [ ...types ].sort()) {
    const count = metricSum(after, `${prefix}job_duration_seconds_count`, { type })
      - metricSum(before, `${prefix}job_duration_seconds_count`, { type });
    const sum = metricSum(after, `${prefix}job_duration_seconds_sum`, { type })
      - metricSum(before, `${prefix}job_duration_seconds_sum`, { type });
    if (count > 0) {
      result[type] = { runs: count, meanMs: (sum / count) * 1000 };
    }
  }
  return result;
}

/** The host's CPU time from `/proc/stat`'s `cpu` line, in seconds: `busy` and `total`. */
export function parseProcStat(text) {
  const line = text.split('\n').find(row => row.startsWith('cpu '));
  if (line === undefined) {
    throw new Error('/proc/stat has no cpu line');
  }
  const [ user, nice, system, idle, iowait, irq, softirq, steal ] = line.trim().split(/\s+/).slice(1).map(Number);
  const total = user + nice + system + idle + iowait + irq + softirq + steal;
  return { busy: (total - idle - iowait) / CLOCK_TICKS, total: total / CLOCK_TICKS };
}

/** A process's own CPU time from `/proc/<pid>/stat` (utime and stime, not its children's), in seconds. */
export function parsePidStat(text) {
  // The command name is in parentheses and may hold spaces: the fields start after the last `)`.
  const fields = text.slice(text.lastIndexOf(')') + 2).trim().split(/\s+/);
  // Fields 14 and 15 of proc(5); the first field after the name is field 3.
  const utime = Number(fields[11]);
  const stime = Number(fields[12]);
  if (!Number.isFinite(utime) || !Number.isFinite(stime)) {
    throw new Error(`Not a /proc/<pid>/stat line: ${text.slice(0, 80)}`);
  }
  return (utime + stime) / CLOCK_TICKS;
}

/** The cgroup v2 path of a process, from `/proc/<pid>/cgroup` (`0::/system.slice/docker-….scope`). */
export function cgroupPathOf(text) {
  const line = text.split('\n').find(row => row.startsWith('0::'));
  if (line === undefined) {
    throw new Error('No cgroup v2 line (0::) in /proc/<pid>/cgroup');
  }
  return line.slice(3).trim();
}

/** A cgroup's CPU time from its `cpu.stat`, in seconds. */
export function parseCpuStat(text) {
  const match = /^usage_usec (\d+)$/m.exec(text);
  if (!match) {
    throw new Error('cpu.stat has no usage_usec');
  }
  return Number(match[1]) / 1e6;
}

/**
 * The PID of the instance's Node.js process, from the PID that `docker
 * inspect` gives for its container: the image's init, `tini` (plan 160), whose
 * one child is the backend, or the backend itself in an image without one.
 */
export function backendPid(containerPid, read = path => readFileSync(path, 'utf8')) {
  if (read(`/proc/${containerPid}/comm`).trim() !== 'tini') {
    return containerPid;
  }
  const children = read(`/proc/${containerPid}/task/${containerPid}/children`).trim().split(/\s+/).filter(Boolean);
  if (children.length !== 1) {
    throw new Error(
      `The container's init (PID ${containerPid}) has ${children.length} children, not the backend alone.`
    );
  }
  return Number(children[0]);
}

/**
 * One reading of the CPU counters; `node` and `container` only with the
 * PID of the instance's Node.js process (see {@link backendPid}).
 */
export function readCpu(instancePid, read = path => readFileSync(path, 'utf8')) {
  const host = parseProcStat(read('/proc/stat'));
  if (instancePid === undefined) {
    return { at: performance.now(), host };
  }
  const cgroup = cgroupPathOf(read(`/proc/${instancePid}/cgroup`));
  return {
    at: performance.now(),
    host,
    node: parsePidStat(read(`/proc/${instancePid}/stat`)),
    container: parseCpuStat(read(`/sys/fs/cgroup${cgroup}/cpu.stat`))
  };
}

/**
 * Where the CPU went between two readings, in CPU cores on average (1.0 is
 * one core busy all the time): the host, and with the instance's PID, its
 * Node.js process, the rest of its container (git and its helpers), and
 * everything else on the host.
 */
export function cpuSplit(first, last) {
  const seconds = (last.at - first.at) / 1000;
  const cores = value => value / seconds;
  const host = cores(last.host.busy - first.host.busy);
  if (first.node === undefined || last.node === undefined) {
    return { seconds, host };
  }
  const node = cores(last.node - first.node);
  const container = cores(last.container - first.container);
  return { seconds, host, node, instanceOther: container - node, rest: host - container };
}

/**
 * The event loop's delay over the scrapes of a run, in milliseconds, from
 * prom-client's default metrics, which restart their histogram at every
 * scrape: the mean of each window's p50, and the highest p99 and max.
 */
export function eventLoopDelay(scrapes, prefix = 'front_burner_') {
  const of = (samples, name) => samples.find(sample => sample.name === `${prefix}nodejs_eventloop_lag_${name}`)?.value;
  const windows = scrapes.slice(1).map(samples => ({
    p50: of(samples, 'p50_seconds'),
    p99: of(samples, 'p99_seconds'),
    max: of(samples, 'max_seconds')
  })).filter(window => window.p50 !== undefined);
  if (windows.length === 0) {
    return undefined;
  }
  return {
    p50: (windows.reduce((total, window) => total + window.p50, 0) / windows.length) * 1000,
    p99: Math.max(...windows.map(window => window.p99)) * 1000,
    max: Math.max(...windows.map(window => window.max)) * 1000
  };
}

/** Busy queue gauges: the highest number of queued jobs by type over the scrapes, where any were queued. */
export function maxQueued(scrapes, prefix = 'front_burner_') {
  const result = {};
  for (const samples of scrapes) {
    for (const sample of samples) {
      if (sample.name === `${prefix}jobs_queued` && sample.value > 0) {
        result[sample.labels.type] = Math.max(result[sample.labels.type] ?? 0, sample.value);
      }
    }
  }
  return result;
}

/**
 * Scrapes the instance's `/api/metrics` with `token` every `everyMs`, and
 * reads the CPU counters with each scrape. `stop()` scrapes once more and
 * resolves with the summary of the whole time; the summary's `scrapes` are
 * the raw samples, for a closer look.
 */
export async function startLoadRecorder({ url, token, containerPid, everyMs = 5000, fetchImpl = fetch }) {
  const instancePid = containerPid === undefined ? undefined : backendPid(containerPid);
  const scrapes = [];
  const loads = [];
  const scrape = async () => {
    const response = await fetchImpl(`${url.replace(/\/$/, '')}/api/metrics`, {
      headers: { authorization: `Bearer ${token}` }
    });
    if (response.status !== 200) {
      await response.body?.cancel();
      throw new Error(`/api/metrics answered ${response.status}: check the token (FRONT_BURNER_METRICS_TOKEN).`);
    }
    scrapes.push(parseMetrics(await response.text()));
    loads.push(loadavg()[0]);
  };
  const firstCpu = readCpu(instancePid);
  await scrape();
  let failure;
  const timer = setInterval(() => {
    scrape().catch(error => (failure ??= error));
  }, everyMs);
  return {
    async stop() {
      clearInterval(timer);
      await scrape();
      if (failure) {
        throw failure;
      }
      return {
        cpu: cpuSplit(firstCpu, readCpu(instancePid)),
        load: Math.max(...loads),
        jobs: jobRunTimes(scrapes[0], scrapes.at(-1)),
        queued: maxQueued(scrapes),
        eventLoop: eventLoopDelay(scrapes),
        scrapes
      };
    }
  };
}

const cores = value => (value === undefined ? '—' : value.toFixed(2));

/**
 * The summary as lines for the terminal. `jobTotals` maps a job type to the
 * mean time the tool saw from a job's request to its `job.finished`, so that
 * the rest of it, the wait for a place in the pool and the event's way back,
 * shows next to the run time.
 */
export function loadLines(summary, jobTotals = {}) {
  const { cpu, eventLoop, jobs, queued, load } = summary;
  const lines = [
    `CPU over ${cpu.seconds.toFixed(0)} s, in cores: host ${cores(cpu.host)}`
    + (cpu.node === undefined
      ? ' (give --instance-pid to split it)'
      : `; instance node ${cores(cpu.node)}, instance git and the rest of its container ${
        cores(cpu.instanceOther)
      }, everything else ${cores(cpu.rest)}`),
    `Load average (1 min), highest: ${load.toFixed(1)}`,
    eventLoop === undefined
      ? 'Event loop delay: no data'
      : `Event loop delay: p50 ${eventLoop.p50.toFixed(1)} ms (mean of the windows), p99 ${
        eventLoop.p99.toFixed(1)
      } ms, max ${eventLoop.max.toFixed(1)} ms (highest window)`
  ];
  for (const [ type, { runs, meanMs } ] of Object.entries(jobs)) {
    const total = jobTotals[type];
    lines.push(
      `Job ${type}: ${runs} run, mean run time ${meanMs.toFixed(0)} ms`
        + (total === undefined
          ? ''
          : `; mean from request to job.finished ${total.toFixed(0)} ms, so ${
            (total - meanMs).toFixed(0)
          } ms waiting or on the way`)
        + (queued[type] === undefined ? '' : `; at most ${queued[type]} queued`)
    );
  }
  return lines;
}
