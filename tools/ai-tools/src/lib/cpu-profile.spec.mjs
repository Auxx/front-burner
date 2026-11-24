import { describe, expect, it } from 'vitest';
import { frameName, packageOf, summariseProfile, timeline } from './cpu-profile.mjs';

const frame = (functionName, url = '', lineNumber = 0) => ({ functionName, url, lineNumber, columnNumber: 0 });

/**
 * root → handler (main.js) → recurse → recurse (main.js) → lstat (node:fs);
 * root → (idle); root → stringify (node_modules/@scope/pkg).
 */
const profile = {
  nodes: [
    { id: 1, callFrame: frame('(root)'), children: [ 2, 6, 7 ] },
    { id: 2, callFrame: frame('handler', 'file:///app/main.js', 9), children: [ 3 ] },
    { id: 3, callFrame: frame('recurse', 'file:///app/main.js', 19), children: [ 4 ] },
    { id: 4, callFrame: frame('recurse', 'file:///app/main.js', 19), children: [ 5 ] },
    { id: 5, callFrame: frame('lstat', 'node:fs', 0), children: [] },
    { id: 6, callFrame: frame('(idle)'), children: [] },
    { id: 7, callFrame: frame('stringify', 'file:///app/node_modules/@scope/pkg/index.js', 4), children: [] }
  ],
  // 1 ms each: lstat 3, recurse (outer) 1, idle 4, stringify 2.
  samples: [ 5, 5, 5, 3, 6, 6, 6, 6, 7, 7 ],
  timeDeltas: Array.from({ length: 10 }, () => 1000)
};

describe('packageOf and frameName', () => {
  it('names packages, Node.js, the application and V8\'s buckets', () => {
    expect(packageOf(frame('x', 'file:///a/node_modules/@nestjs/core/x.js'))).toBe('@nestjs/core');
    expect(packageOf(frame('x', 'file:///a/node_modules/express/x.js'))).toBe('express');
    expect(packageOf(frame('lstat', 'node:fs'))).toBe('node');
    expect(packageOf(frame('(garbage collector)'))).toBe('(garbage collector)');
    expect(packageOf(frame('handler', 'file:///app/main.js'))).toBe('application');
    expect(packageOf(frame('spawn'))).toBe('(native)');
    expect(frameName(frame('', 'file:///app/main.js', 4))).toBe('(anonymous) main.js:5');
    expect(frameName(frame('f', 'file:///a/node_modules/x/y.js', 0))).toBe('f node_modules/x/y.js:1');
  });
});

describe('summariseProfile', () => {
  it('gives self and total time, counting recursion once, and self time by package', () => {
    const summary = summariseProfile(profile);
    expect(summary).toMatchObject({ lengthMs: 10, windowMs: 10, busyMs: 6 });
    expect(summary.self).toEqual([
      { name: '(idle)', ms: 4 },
      { name: 'lstat node:fs:1', ms: 3 },
      { name: 'stringify node_modules/@scope/pkg/index.js:5', ms: 2 },
      { name: 'recurse main.js:20', ms: 1 }
    ]);
    expect(summary.total).toEqual([
      { name: 'handler main.js:10', ms: 4 },
      { name: 'recurse main.js:20', ms: 4 },
      { name: 'lstat node:fs:1', ms: 3 },
      { name: 'stringify node_modules/@scope/pkg/index.js:5', ms: 2 }
    ]);
    expect(summary.packages).toEqual([
      { name: '(idle)', ms: 4 },
      { name: 'node', ms: 3 },
      { name: '@scope/pkg', ms: 2 },
      { name: 'application', ms: 1 }
    ]);
  });

  it('keeps to a window of the profile', () => {
    // Samples end at 1, 2, … 10 ms: [3, 9) holds those ending at 3 to 8, the last lstat, recurse and four idle.
    const summary = summariseProfile(profile, { fromMs: 3, toMs: 9 });
    expect(summary).toMatchObject({ windowMs: 6, busyMs: 2 });
    expect(summary.self.map(row => row.name)).toEqual([ '(idle)', 'lstat node:fs:1', 'recurse main.js:20' ]);
  });

  it('refuses what is not a profile', () => {
    expect(() => summariseProfile({ nodes: [] })).toThrow(/Not a V8 CPU profile/);
    expect(() => summariseProfile({ ...profile, samples: [ 99 ], timeDeltas: [ 1 ] })).toThrow(/node 99/);
  });
});

describe('timeline', () => {
  it('gives the busy time of each bucket, a sample counted where it ends', () => {
    // Ends at 1–4: three lstat, recurse; 5–9: four idle, a stringify; 10: a stringify.
    expect(timeline(profile, 5)).toEqual([
      { fromMs: 0, busyMs: 4 },
      { fromMs: 5, busyMs: 1 },
      { fromMs: 10, busyMs: 1 }
    ]);
  });
});
