/**
 * The pure part of `perf-api.mjs`: percentiles, the `Server-Timing` header,
 * the push channel's wire format and the results table.
 */

/** The `p`th percentile (0 to 100) of `values`, nearest rank; undefined when there are none. */
export function percentile(values, p) {
  if (values.length === 0) {
    return undefined;
  }
  const sorted = [ ...values ].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1];
}

/** p50, p95 and max of `values`, in milliseconds. */
export function summarise(values) {
  return {
    runs: values.length,
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    max: values.length === 0 ? undefined : Math.max(...values)
  };
}

/**
 * The server's own duration from a `Server-Timing` header, `app;dur=12.3`,
 * in milliseconds; undefined when the header is missing or has no `app`.
 */
export function parseServerTiming(header) {
  if (typeof header !== 'string') {
    return undefined;
  }
  for (const metric of header.split(',')) {
    const [ name, ...params ] = metric.split(';').map(part => part.trim());
    if (name !== 'app') {
      continue;
    }
    for (const param of params) {
      const match = /^dur=(\d+(?:\.\d+)?)$/.exec(param);
      if (match) {
        return Number(match[1]);
      }
    }
  }
  return undefined;
}

/**
 * A reader of Server-Sent Events: feed it chunks of text as they arrive; it
 * calls `onEvent({ event, data })` for each complete event. Comments (lines
 * starting with `:`) are skipped.
 */
export function createSseParser(onEvent) {
  let buffer = '';
  return chunk => {
    buffer += chunk.replaceAll('\r\n', '\n');
    let end;
    while ((end = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      let event = 'message';
      const data = [];
      for (const line of block.split('\n')) {
        if (line.startsWith(':')) {
          continue;
        }
        const colon = line.indexOf(':');
        const field = colon < 0 ? line : line.slice(0, colon);
        const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
        if (field === 'event') {
          event = value;
        } else if (field === 'data') {
          data.push(value);
        }
      }
      if (data.length > 0) {
        onEvent({ event, data: data.join('\n') });
      }
    }
  };
}

/**
 * The operations measured and their targets (NF-2). `kind` says what a
 * sample is: `server`, the `Server-Timing` duration; `job`, the time from the
 * request to `job.finished`, from which the median of plain git's time is
 * taken (`overhead`); `about`, a soft target ("about 2 seconds", NF-2.8);
 * `info`, the time from the request to `job.finished`, with no target: that
 * it works at this size is the check (NF-1.4).
 */
export const OPERATIONS = {
  folder: { label: 'Open a folder of 1,000 entries', rule: 'NF-2.1', kind: 'server', targetMs: 300 },
  file: { label: 'Open a 100 KB Markdown file', rule: 'NF-2.2', kind: 'server', targetMs: 200 },
  save: { label: 'Save a 100 KB file', rule: 'NF-2.3', kind: 'server', targetMs: 200 },
  pull: { label: 'Pull (job) over git pull', rule: 'NF-2.6', kind: 'job', targetMs: 1000 },
  push: { label: 'Push (job) over git push', rule: 'NF-2.6', kind: 'job', targetMs: 1000 },
  'status-cold': { label: 'Status, cold, 100,000 files', rule: 'NF-2.8', kind: 'about', targetMs: 2000 },
  'status-warm': { label: 'Status, warm, 100,000 files', rule: 'NF-2.8', kind: 'about', targetMs: 2000 },
  'commit-cold': { label: 'Commit, cold, 100,000 files', rule: 'NF-2.8', kind: 'about', targetMs: 2000 },
  'commit-warm': { label: 'Commit, warm, 100,000 files', rule: 'NF-2.8', kind: 'about', targetMs: 2000 },
  'push-large': { label: 'Push (job), 100,000 files', rule: 'NF-1.4', kind: 'info' }
};

/**
 * One result row per measured operation. `samples` maps an operation to its
 * durations; for a `job` operation, `baselines` maps it to plain git's, and
 * the row's p50, p95 and max are the job's minus git's median, the time the
 * instance adds (NF-2.6).
 */
export function resultRows(samples, baselines = {}) {
  const rows = [];
  for (const [ key, operation ] of Object.entries(OPERATIONS)) {
    const values = samples[key];
    if (!values || values.length === 0) {
      continue;
    }
    const summary = summarise(values);
    let row = { key, ...operation, ...summary };
    if (operation.kind === 'job') {
      const git = percentile(baselines[key] ?? [], 50);
      if (git === undefined) {
        throw new Error(`No plain git baseline for ${key}`);
      }
      row = {
        ...row,
        jobP95: summary.p95,
        gitP50: git,
        p50: summary.p50 - git,
        p95: summary.p95 - git,
        max: summary.max - git
      };
    }
    rows.push({ ...row, pass: operation.targetMs === undefined || row.p95 <= operation.targetMs });
  }
  return rows;
}

const ms = value => (value === undefined ? '—' : `${value.toFixed(value < 10 ? 1 : 0)} ms`);

/** The results as a table for the terminal and the checklist. */
export function resultTable(rows) {
  const header = [ 'Rule', 'Operation', 'Runs', 'p50', 'p95', 'Max', 'Target', 'Pass' ];
  const lines = rows.map(row => [
    row.rule,
    row.label,
    String(row.runs),
    ms(row.p50),
    ms(row.p95),
    ms(row.max),
    row.kind === 'job'
      ? `≤ ${ms(row.targetMs)} added (job p95 ${ms(row.jobP95)}, git p50 ${ms(row.gitP50)})`
      : `${row.kind === 'about' ? '≈ ' : ''}${ms(row.targetMs)}`,
    row.kind === 'info' ? '—' : row.pass ? 'yes' : 'NO'
  ]);
  return [ header, ...lines ];
}
