import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listStories, parseViewport, serve, storybookDir, variantLabel, variants } from './storybook.mjs';
import { OutsideWorkspaceError, WORKSPACE_ROOT, workspacePath } from './workspace.mjs';

/** A raw GET, so that `..` in the path reaches the server as it is. */
function get(url, path) {
  return new Promise((done, fail) => {
    const { hostname, port } = new URL(url);
    request({ hostname, port, path }, response => {
      let body = '';
      response.on('data', chunk => (body += chunk));
      response.on('end', () => done({ status: response.statusCode, type: response.headers['content-type'], body }));
    }).on('error', fail).end();
  });
}

describe('storybook', () => {
  let fixture;

  beforeAll(() => {
    mkdirSync(join(WORKSPACE_ROOT, 'tmp'), { recursive: true });
    fixture = mkdtempSync(join(WORKSPACE_ROOT, 'tmp', 'ai-tools-storybook-'));
    writeFileSync(join(fixture, 'iframe.html'), '<p>story</p>');
    writeFileSync(
      join(fixture, 'index.json'),
      JSON.stringify({
        v: 5,
        entries: {
          'controls-button--variants': {
            type: 'story',
            id: 'controls-button--variants',
            title: 'Controls/Button',
            name: 'Variants'
          },
          'controls-button--docs': {
            type: 'docs',
            id: 'controls-button--docs',
            title: 'Controls/Button',
            name: 'Docs'
          },
          'layout-island--basic': { type: 'story', id: 'layout-island--basic', title: 'Layout/Island', name: 'Basic' }
        }
      })
    );
  });

  afterAll(() => rmSync(fixture, { recursive: true, force: true }));

  it('lists stories, without docs pages, filtered by id or title', () => {
    expect(listStories(fixture).map(s => s.id)).toEqual([ 'controls-button--variants', 'layout-island--basic' ]);
    expect(listStories(fixture, 'layout/').map(s => s.id)).toEqual([ 'layout-island--basic' ]);
  });

  it('asks for a build when there is no Storybook, and stays in the workspace', () => {
    expect(() => storybookDir('tmp/no-storybook-here')).toThrow('npx nx run ui:build-storybook');
    expect(() => storybookDir('/tmp')).toThrow(OutsideWorkspaceError);
    expect(storybookDir(workspacePath(fixture))).toBe(fixture);
  });

  it('builds every combination of themes and densities', () => {
    const list = variants({
      theme: [ 'light', 'dark' ],
      density: [ 'compact', 'touch' ],
      viewport: { width: 320, height: 480 }
    });
    expect(list.map(variantLabel)).toEqual([
      'light-compact-320x480',
      'light-touch-320x480',
      'dark-compact-320x480',
      'dark-touch-320x480'
    ]);
    const [ forced ] = variants({ forcedColors: true, reducedMotion: true, viewport: { width: 480, height: 640 } });
    expect(variantLabel(forced)).toBe('light-compact-forced-reduced-480x640');
  });

  it('parses viewports', () => {
    expect(parseViewport('480x640')).toEqual({ width: 480, height: 640 });
    expect(() => parseViewport('480')).toThrow('Not a viewport');
  });

  it('serves the folder and nothing outside it', async () => {
    const server = await serve(fixture);
    try {
      expect(await get(server.url, '/iframe.html')).toMatchObject({
        status: 200,
        type: 'text/html',
        body: '<p>story</p>'
      });
      expect((await get(server.url, '/missing.js')).status).toBe(404);
      // URL parsing resolves `..` and `%2e%2e` to /nx.json, which the folder
      // does not have; an encoded slash reaches the server's own check.
      expect((await get(server.url, '/../../nx.json')).status).toBe(404);
      expect((await get(server.url, '/%2e%2e/%2e%2e/nx.json')).status).toBe(404);
      expect((await get(server.url, '/..%2F..%2F..%2Fnx.json')).status).toBe(403);
    } finally {
      await server.close();
    }
  });
});
