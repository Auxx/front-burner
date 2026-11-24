/**
 * Summaries of a V8 CPU profile (`.cpuprofile`, as `node --cpu-prof` writes
 * it): where a Node.js process spent its time, by function and by package,
 * over the whole profile or a window of it. Pure functions of the parsed JSON.
 */

/** Names V8 gives to time that is not in a JavaScript function. */
const SPECIAL = new Set([ '(root)', '(program)', '(idle)', '(garbage collector)' ]);

/** Throws unless `profile` looks like a `.cpuprofile`. */
function check(profile) {
  if (
    !profile || !Array.isArray(profile.nodes) || !Array.isArray(profile.samples)
    || !Array.isArray(profile.timeDeltas) || profile.samples.length !== profile.timeDeltas.length
  ) {
    throw new Error('Not a V8 CPU profile: it needs nodes, samples and timeDeltas of the same length.');
  }
}

/** Where a call frame's code comes from: a package, Node.js itself, the application, or a V8 bucket. */
export function packageOf(callFrame) {
  const { functionName, url } = callFrame;
  if (SPECIAL.has(functionName) && url === '') {
    return functionName;
  }
  if (url.startsWith('node:')) {
    return 'node';
  }
  const match = /node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(url.replaceAll('\\', '/'));
  if (match) {
    return match[1];
  }
  return url === '' ? '(native)' : 'application';
}

/** A function's name and place, the same for every node of it in the tree. */
export function frameName(callFrame) {
  const { functionName, url, lineNumber } = callFrame;
  if (SPECIAL.has(functionName) && url === '') {
    return functionName;
  }
  const file = url === '' ? '(native)' : url.replace(/^.*\/(node_modules\/)/, '$1').replace(/^file:\/\/.*\//, '');
  return `${functionName || '(anonymous)'} ${file}:${lineNumber + 1}`;
}

/**
 * Milliseconds of samples by node ID, for samples whose time is within
 * `[fromMs, toMs)` of the profile's start. Each sample's time is the delta
 * that precedes it.
 */
function sampledTime(profile, fromMs, toMs) {
  const byNode = new Map();
  let at = 0;
  let total = 0;
  for (let index = 0; index < profile.samples.length; index++) {
    const delta = profile.timeDeltas[index] / 1000;
    at += delta;
    if (at < fromMs || at >= toMs) {
      continue;
    }
    const id = profile.samples[index];
    byNode.set(id, (byNode.get(id) ?? 0) + delta);
    total += delta;
  }
  return { byNode, total };
}

/**
 * The profile summarised over `[fromMs, toMs)` of its time (all of it by
 * default): its length, the busy time (not idle), the top functions by self
 * time and by total time (each counted once per stack, so recursion does not
 * count twice), and self time by package. Times in milliseconds.
 */
export function summariseProfile(profile, { fromMs = 0, toMs = Infinity, top = 25 } = {}) {
  check(profile);
  const nodes = new Map(profile.nodes.map(node => [ node.id, node ]));
  const parents = new Map();
  for (const node of profile.nodes) {
    for (const child of node.children ?? []) {
      parents.set(child, node.id);
    }
  }
  const { byNode, total } = sampledTime(profile, fromMs, toMs);
  const self = new Map();
  const inclusive = new Map();
  const packages = new Map();
  const add = (map, key, ms) => map.set(key, (map.get(key) ?? 0) + ms);
  for (const [ id, ms ] of byNode) {
    const node = nodes.get(id);
    if (node === undefined) {
      throw new Error(`A sample names node ${id}, which the profile does not have.`);
    }
    add(self, frameName(node.callFrame), ms);
    add(packages, packageOf(node.callFrame), ms);
    const seen = new Set();
    for (let current = id; current !== undefined; current = parents.get(current)) {
      const name = frameName(nodes.get(current).callFrame);
      if (!seen.has(name)) {
        seen.add(name);
        add(inclusive, name, ms);
      }
    }
  }
  const sorted = (map, limit) =>
    [ ...map ].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(([ name, ms ]) => ({
      name,
      ms
    }));
  const idle = self.get('(idle)') ?? 0;
  const lengthMs = profile.timeDeltas.reduce((sum, delta) => sum + delta, 0) / 1000;
  return {
    lengthMs,
    windowMs: total,
    busyMs: total - idle,
    self: sorted(self, top),
    total: sorted(new Map([ ...inclusive ].filter(([ name ]) => !SPECIAL.has(name))), top),
    packages: sorted(packages, Infinity)
  };
}

/**
 * Busy (not idle) milliseconds in each `bucketMs` of the profile, so that the
 * part to summarise can be picked, such as a load test after a long start.
 */
export function timeline(profile, bucketMs = 5000) {
  check(profile);
  const idleIds = new Set(profile.nodes.filter(node => node.callFrame.functionName === '(idle)').map(node => node.id));
  const buckets = [];
  let at = 0;
  for (let index = 0; index < profile.samples.length; index++) {
    const delta = profile.timeDeltas[index] / 1000;
    at += delta;
    const bucket = Math.floor(at / bucketMs);
    while (buckets.length <= bucket) {
      buckets.push(0);
    }
    if (!idleIds.has(profile.samples[index])) {
      buckets[bucket] += delta;
    }
  }
  return buckets.map((busyMs, index) => ({ fromMs: index * bucketMs, busyMs }));
}
