import { describe, expect, it } from 'vitest';
import {
  MEASURES,
  previewMarkdown,
  PROFILES,
  SCREEN_OPERATIONS,
  selectMeasures,
  sessionOnly,
  sessionState,
  SLOW_4G
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
