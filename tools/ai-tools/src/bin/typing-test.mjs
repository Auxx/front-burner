#!/usr/bin/env node
import { main, print, table, UsageError } from '../lib/cli.mjs';
import { buildSite, createSiteServer, DEFAULT_OUT_DIR, siteUrls } from '../lib/typing-test-site.mjs';
import { workspacePath } from '../lib/workspace.mjs';

const outOption = { out: { type: 'string', default: DEFAULT_OUT_DIR } };

function report(built) {
  return [
    `Built ${workspacePath(built.dir)}: app.js ${built.appGzipBytes.toLocaleString('en')} bytes gzipped.`,
    table([ [ 'file', 'bytes' ], ...built.files.map(file => [ file.name, file.bytes.toLocaleString('en') ]) ])
  ].join('\n');
}

main({
  name: 'typing-test',
  summary: 'The page for checking typing speed on a real phone (NF-2.4); see docs/wiki/typing-test.md.',
  commands: {
    build: {
      usage: '[--out tmp/typing-test] [--json]',
      summary: 'Bundles the test page and writes the 200 KB and 1 MB test files.',
      options: { ...outOption, json: { type: 'boolean' } },
      async run(options) {
        const built = await buildSite(options.out);
        print(options.json, built, () => report(built));
      }
    },
    serve: {
      usage: '[--out tmp/typing-test] [--host 0.0.0.0] [--port 8080]',
      summary: 'Builds the page, then serves it to the local network until stopped with Ctrl+C.',
      help: [
        'Listens on every interface by default, so that a phone on the same Wi-Fi can',
        'open one of the printed addresses. With `adb reverse tcp:8080 tcp:8080` an',
        'Android phone on USB can open http://localhost:8080/ instead.'
      ].join('\n'),
      options: {
        ...outOption,
        host: { type: 'string', default: '0.0.0.0' },
        port: { type: 'string', default: '8080' }
      },
      async run(options) {
        const port = Number(options.port);
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
          throw new UsageError(`Not a port: ${options.port}`);
        }
        const built = await buildSite(options.out);
        console.log(report(built));
        const server = createSiteServer(built.dir);
        await new Promise((resolve, reject) => {
          server.listen(port, options.host, resolve).on('error', reject);
        });
        const urls = options.host === '0.0.0.0' ? siteUrls(port) : [ `http://${options.host}:${port}/` ];
        console.log(
          [
            '',
            'Open on the phone:',
            ...urls.map(url => `  ${url}`),
            `  http://localhost:${port}/ (with adb reverse)`,
            '',
            'Stop with Ctrl+C.'
          ].join('\n')
        );
        // Serves until the process is stopped.
        return new Promise(resolve => server.on('close', () => resolve(0)));
      }
    }
  }
});
