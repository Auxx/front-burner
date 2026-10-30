import { createPreviewWorker, workerScriptUrl } from './create-preview-worker';

describe('createPreviewWorker', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('allows the builder\'s worker chunks from this origin', () => {
    expect(workerScriptUrl('/worker-ABC123.js')).toBe(`${location.origin}/worker-ABC123.js`);
    expect(workerScriptUrl(`${location.origin}/app/worker-x_1.js`)).toBe(`${location.origin}/app/worker-x_1.js`);
  });

  it('refuses a worker URL from another origin', () => {
    expect(() => workerScriptUrl('https://evil.example/worker-ABC123.js')).toThrow(TypeError);
    expect(() => workerScriptUrl('data:text/javascript,worker-x.js')).toThrow(TypeError);
    expect(() => workerScriptUrl('blob:https://evil.example/worker-x.js')).toThrow(TypeError);
  });

  it('refuses any other script of this origin', () => {
    expect(() => workerScriptUrl('/main-ABC123.js')).toThrow(TypeError);
    expect(() => workerScriptUrl('/worker-ABC123.js?x=1')).toThrow(TypeError);
    expect(() => workerScriptUrl('/worker-ABC123.js.map')).toThrow(TypeError);
  });

  it('passes the worker\'s URL through the fb-worker policy', () => {
    const urls: unknown[] = [];
    vi.stubGlobal(
      'Worker',
      class {
        constructor(url: unknown) {
          urls.push(url);
        }
      }
    );
    const created: { name: string; url: string; }[] = [];
    vi.stubGlobal('trustedTypes', {
      createPolicy: (name: string, rules: { createScriptURL: (url: string) => string; }) => ({
        createScriptURL: (url: string) => {
          created.push({ name, url });
          return rules.createScriptURL(url);
        }
      })
    });

    // Under test the worker's URL is a file, which the policy refuses.
    expect(() => createPreviewWorker()).toThrow(TypeError);
    expect(created).toEqual([ { name: 'fb-worker', url: expect.stringMatching(/preview\.worker/) } ]);
    expect(urls).toEqual([]);
  });
});
