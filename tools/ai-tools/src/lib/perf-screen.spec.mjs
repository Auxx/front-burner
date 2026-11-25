import { describe, expect, it } from 'vitest';
import {
  expiresSoon,
  MEASURES,
  previewMarkdown,
  PROFILES,
  SCREEN_OPERATIONS,
  selectMeasures,
  sessionOnly,
  sessionState,
  SLOW_4G,
  waves
} from './perf-screen.mjs';
import { allPass, resultRows, resultTable } from './perf-stats.mjs';

describe('SLOW_4G', () => {
  it('is Chrome DevTools\' Slow 4G preset', () => {
    expect(SLOW_4G).toEqual({ offline: false, latency: 562.5, downloadThroughput: 180_000, uploadThroughput: 84_375 });
  });
});

describe('PROFILES', () => {
  it('slows the phone\'s CPU 4 times, not the desktop\'s', () => {
    expect(PROFILES.desktop.cpuRate).toBe(1);
    expect(PROFILES.phone).toEqual({ device: 'Pixel 7', cpuRate: 4 });
  });
});

describe('selectMeasures', () => {
  it('runs every measure by default, broadband on the desktop only', () => {
    expect(selectMeasures(undefined, 'desktop')).toEqual(MEASURES);
    expect(selectMeasures(undefined, 'phone')).toEqual([ 'first-load', 'folder', 'editor-slow-4g', 'preview' ]);
  });

  it('keeps the order of the table whatever the order asked', () => {
    expect(selectMeasures('preview, folder', 'desktop')).toEqual([ 'folder', 'preview' ]);
  });

  it('refuses an unknown measure', () => {
    expect(() => selectMeasures('folder,typing', 'desktop')).toThrow(/Unknown measure: typing/);
  });
});

describe('sessionState', () => {
  it('stores the session where the web client reads it, never the refresh token', () => {
    const cookie = { name: 'fb_refresh', value: 'secret', domain: '127.0.0.1', path: '/api/v1/auth' };
    const state = sessionState('http://127.0.0.1:3000', [ cookie ], {
      authToken: 'token',
      authTokenExpiresAt: '2026-11-21T12:15:00.000Z',
      refreshTokenExpiresAt: '2026-12-21T12:00:00.000Z',
      refreshToken: 'never'
    });

    expect(state.cookies).toEqual([ cookie ]);
    expect(state.origins).toEqual([
      {
        origin: 'http://127.0.0.1:3000',
        localStorage: [
          {
            name: 'front-burner.auth',
            value: JSON.stringify({
              authToken: 'token',
              authTokenExpiresAt: '2026-11-21T12:15:00.000Z',
              refreshTokenExpiresAt: '2026-12-21T12:00:00.000Z'
            })
          }
        ]
      }
    ]);
  });
});

describe('expiresSoon', () => {
  const now = Date.parse('2026-11-21T12:00:00Z');
  const stateWith = value => ({
    cookies: [],
    origins: [ { origin: 'http://127.0.0.1:3000', localStorage: [ { name: 'front-burner.auth', value } ] } ]
  });
  const expiring = at => stateWith(JSON.stringify({ authTokenExpiresAt: at }));

  it('tells a token with time left from one about to expire', () => {
    expect(expiresSoon(expiring('2026-11-21T12:10:00Z'), now, 5 * 60_000)).toBe(false);
    expect(expiresSoon(expiring('2026-11-21T12:04:59Z'), now, 5 * 60_000)).toBe(true);
    expect(expiresSoon(expiring('2026-11-21T11:59:00Z'), now, 5 * 60_000)).toBe(true);
  });

  it('counts a missing or unreadable session as expiring', () => {
    expect(expiresSoon({ cookies: [], origins: [] }, now, 0)).toBe(true);
    expect(expiresSoon(stateWith('not json'), now, 0)).toBe(true);
    expect(expiresSoon(stateWith('{}'), now, 0)).toBe(true);
  });
});

describe('sessionOnly', () => {
  it('keeps the cookies and the session, not what the device remembers', () => {
    const cookies = [ { name: 'fb_refresh', value: 'secret' } ];
    const session = { name: 'front-burner.auth', value: '{}' };
    const state = {
      cookies,
      origins: [
        {
          origin: 'http://127.0.0.1:3000',
          localStorage: [ session, { name: 'fb.1.repo.2.expanded', value: '["many"]' } ]
        }
      ]
    };

    expect(sessionOnly(state)).toEqual({
      cookies,
      origins: [ { origin: 'http://127.0.0.1:3000', localStorage: [ session ] } ]
    });
  });
});

describe('previewMarkdown', () => {
  it('is 200 KB of short blocks', () => {
    const text = previewMarkdown();
    expect(text.length).toBe(200 * 1024);
    expect(text.split('\n\n').length).toBeGreaterThan(1000);
  });
});

describe('the screen rows', () => {
  it('passes on p95 within the target and shows the warm first load for information', () => {
    const rows = resultRows(
      { 'first-load': [ 3000, 4000, 4900 ], 'first-load-warm': [ 900 ], preview: [ 120, 310 ] },
      {},
      SCREEN_OPERATIONS
    );

    expect(rows.map(row => [ row.key, row.pass ])).toEqual([
      [ 'first-load', true ],
      [ 'first-load-warm', true ],
      [ 'preview', false ]
    ]);
    const table = resultTable(rows);
    expect(table[2].slice(6)).toEqual([ '—', '—' ]);
    expect(table[3].slice(4)).toEqual([ '310 ms', '310 ms', '300 ms', 'NO' ]);
    expect(allPass(rows)).toBe(false);
  });
});

describe('waves', () => {
  const request = (url, start, end) => ({ url, start, end });

  it('puts requests that start before any has ended in wave 1', () => {
    expect(waves([ request('/a', 0, 600), request('/b', 10, 700), request('/c', 599, 800) ]).map(r => r.wave))
      .toEqual([ 1, 1, 1 ]);
  });

  it('starts wave 2 at the first request that starts after one has ended', () => {
    const result = waves([
      request('/index.html', 0, 600),
      request('/main.js', 600, 1700),
      request('/chunk.js', 620, 1300),
      request('/lazy.js', 1300, 1900),
      request('/en.json', 1310, 1950),
      request('/api', 1960, 2500)
    ]);

    expect(result.map(r => [ r.url, r.wave ])).toEqual([
      [ '/index.html', 1 ],
      [ '/main.js', 2 ],
      [ '/chunk.js', 2 ],
      [ '/lazy.js', 3 ],
      [ '/en.json', 3 ],
      [ '/api', 4 ]
    ]);
  });

  it('sorts by start, ties by URL', () => {
    expect(waves([ request('/b', 5, 50), request('/a', 5, 40), request('/c', 0, 30) ]).map(r => r.url))
      .toEqual([ '/c', '/a', '/b' ]);
  });

  it('ignores requests that started before the measure', () => {
    expect(waves([ request('/old', -100, 20), request('/new', 0, 600) ])).toEqual([
      { url: '/new', start: 0, end: 600, wave: 1 }
    ]);
  });
});
