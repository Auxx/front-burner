import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { PreviewRequest, PreviewResponse } from '../../worker/preview-protocol';
import {
  PREVIEW_DELAY_MS,
  PREVIEW_LARGE_DELAY_MS,
  PREVIEW_LARGE_FILE,
  PREVIEW_WORKER,
  PreviewRendererService
} from './preview-renderer.service';

/** A worker that records requests and answers when told to. */
class FakeWorker extends EventTarget {
  readonly requests: PreviewRequest[] = [];
  terminated = false;

  postMessage(request: PreviewRequest): void {
    this.requests.push(request);
  }

  terminate(): void {
    this.terminated = true;
  }

  answer(response: PreviewResponse): void {
    this.dispatchEvent(new MessageEvent('message', { data: response }));
  }

  /** The updates sent, by text. */
  get updates(): string[] {
    return this.requests.flatMap(request => request.type === 'update' ? [ request.source ] : []);
  }
}

function update(id: number, keys: string[], rendered: string[] = keys): PreviewResponse {
  return {
    type: 'update',
    id,
    layout: keys.map((key, index) => ({ key, fromLine: index + 1, toLine: index + 1 })),
    rendered: rendered.map(key => ({ key, html: `<p>${key}</p>`, removals: [] })),
    removals: [ [ 'tag:script', id ] ]
  };
}

describe('PreviewRendererService', () => {
  let worker: FakeWorker;
  let service: PreviewRendererService;
  let text: string;
  let reads: number;
  const version = signal(0);

  beforeEach(() => {
    vi.useFakeTimers();
    worker = new FakeWorker();
    text = 'First';
    reads = 0;
    version.set(0);
    TestBed.configureTestingModule({
      providers: [ PreviewRendererService, { provide: PREVIEW_WORKER, useValue: () => worker } ]
    });
    service = TestBed.inject(PreviewRendererService);
  });

  afterEach(() => vi.useRealTimers());

  function connect() {
    const state = service.connect({
      version,
      read: () => {
        reads++;
        return text;
      }
    });
    TestBed.tick();
    return state;
  }

  function change(next: string): void {
    text = next;
    version.update(value => value + 1);
    TestBed.tick();
  }

  it('renders at once when connected', () => {
    connect();

    expect(worker.requests).toEqual([ { type: 'update', id: 1, source: 'First' } ]);
  });

  it('waits 100 ms, or 1 s above 256 KB', () => {
    connect();
    change('Second');
    vi.advanceTimersByTime(PREVIEW_DELAY_MS - 1);
    expect(worker.updates).toEqual([ 'First' ]);
    vi.advanceTimersByTime(1);
    expect(worker.updates).toEqual([ 'First', 'Second' ]);

    const large = 'x'.repeat(PREVIEW_LARGE_FILE + 1);
    change(large);
    vi.advanceTimersByTime(PREVIEW_DELAY_MS);
    change(`${large}y`);
    vi.advanceTimersByTime(PREVIEW_LARGE_DELAY_MS - 1);
    expect(worker.updates).toHaveLength(3);
    vi.advanceTimersByTime(1);
    expect(worker.updates).toHaveLength(4);
  });

  it('reads the text once per update, not per change', () => {
    connect();
    for (let index = 0; index < 5; index++) {
      change(`Typing ${index}`);
      vi.advanceTimersByTime(PREVIEW_DELAY_MS / 2);
    }
    vi.advanceTimersByTime(PREVIEW_DELAY_MS);

    expect(reads).toBe(2);
    expect(worker.updates).toEqual([ 'First', 'Typing 4' ]);
  });

  it('shows the answer to the latest update', () => {
    const state = connect();
    expect(state()).toBeNull();

    worker.answer(update(1, [ 'a', 'b' ]));

    expect(state()).toEqual({
      layout: [ { key: 'a', fromLine: 1, toLine: 1 }, { key: 'b', fromLine: 2, toLine: 2 } ],
      rendered: new Map([ [ 'a', '<p>a</p>' ], [ 'b', '<p>b</p>' ] ]),
      removals: new Map([ [ 'tag:script', 1 ] ]),
      id: 1
    });
  });

  it('keeps the blocks it holds and forgets those that left the layout', () => {
    const state = connect();
    worker.answer(update(1, [ 'a', 'b' ]));
    change('Second');
    vi.advanceTimersByTime(PREVIEW_DELAY_MS);

    worker.answer(update(2, [ 'a', 'c' ], [ 'c' ]));

    expect([ ...(state()?.rendered ?? []) ]).toEqual([ [ 'a', '<p>a</p>' ], [ 'c', '<p>c</p>' ] ]);
  });

  it('drops an answer overtaken by a newer update', () => {
    const state = connect();
    change('Second');
    vi.advanceTimersByTime(PREVIEW_DELAY_MS);

    worker.answer(update(1, [ 'old' ]));
    expect(state()).toBeNull();
    // The worker does not send the blocks of the overtaken answer again.
    worker.answer(update(2, [ 'old', 'new' ], [ 'new' ]));

    expect(state()?.id).toBe(2);
    expect([ ...(state()?.rendered.keys() ?? []) ]).toEqual([ 'old', 'new' ]);
  });

  it('keeps showing the last version when an update fails', () => {
    const state = connect();
    worker.answer(update(1, [ 'a' ]));
    change('Second');
    vi.advanceTimersByTime(PREVIEW_DELAY_MS);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    worker.answer({ type: 'error', id: 2, message: 'Broken' });

    expect(state()?.id).toBe(1);
  });

  it('forgets every block on reset, and drops answers from before it', () => {
    const state = connect();
    worker.answer(update(1, [ 'a' ]));

    service.reset();
    worker.answer(update(1, [ 'a' ]));
    change('Other file');
    vi.advanceTimersByTime(PREVIEW_DELAY_MS);

    expect(worker.requests.at(1)).toEqual({ type: 'reset' });
    expect(state()).toBeNull();
    worker.answer(update(2, [ 'b' ]));
    expect([ ...(state()?.rendered.keys() ?? []) ]).toEqual([ 'b' ]);
  });

  it('forgets the blocks and renders another source at once', () => {
    const first = { version: signal(0), read: () => 'First file' };
    const second = { version: signal(0), read: () => 'Second file' };
    const source = signal(first);
    const state = service.connect(source);
    TestBed.tick();
    worker.answer(update(1, [ 'a' ]));

    source.set(second);
    TestBed.tick();

    expect(worker.requests.slice(1)).toEqual([ { type: 'reset' }, { type: 'update', id: 2, source: 'Second file' } ]);
    expect(state()).toBeNull();
    second.version.set(1);
    TestBed.tick();
    vi.advanceTimersByTime(PREVIEW_DELAY_MS);
    expect(worker.updates).toEqual([ 'First file', 'Second file', 'Second file' ]);
  });

  it('does no work while inactive', () => {
    const active = signal(false);
    service.connect({
      version,
      read: () => {
        reads++;
        return text;
      }
    }, active);
    TestBed.tick();
    change('Second');
    vi.advanceTimersByTime(PREVIEW_LARGE_DELAY_MS);

    expect(reads).toBe(0);
    expect(worker.requests).toEqual([]);
  });

  it('renders the newest text at once when it becomes active', () => {
    const active = signal(true);
    service.connect({ version, read: () => text }, active);
    TestBed.tick();
    active.set(false);
    TestBed.tick();
    change('Second');

    active.set(true);
    TestBed.tick();

    expect(worker.updates).toEqual([ 'First', 'Second' ]);
    vi.advanceTimersByTime(PREVIEW_DELAY_MS);
    expect(worker.updates).toEqual([ 'First', 'Second' ]);
  });

  it('does not render again when it becomes active without a change', () => {
    const active = signal(true);
    service.connect({ version, read: () => text }, active);
    TestBed.tick();
    active.set(false);
    TestBed.tick();

    active.set(true);
    TestBed.tick();

    expect(worker.updates).toEqual([ 'First' ]);
  });

  it('is busy while newer text waits or renders', () => {
    connect();
    expect(service.busy()).toBe(true);
    worker.answer(update(1, [ 'a' ]));
    expect(service.busy()).toBe(false);

    change('Second');
    expect(service.busy()).toBe(true);
    vi.advanceTimersByTime(PREVIEW_DELAY_MS);
    expect(service.busy()).toBe(true);
    worker.answer({ type: 'error', id: 2, message: 'Broken' });
    expect(service.busy()).toBe(false);
  });

  it('is not busy after a reset drops the update in flight', () => {
    connect();
    expect(service.busy()).toBe(true);

    service.reset();

    expect(service.busy()).toBe(false);
  });

  it('terminates the worker', () => {
    connect();

    TestBed.resetTestingModule();

    expect(worker.terminated).toBe(true);
  });

  it('stops waiting when destroyed', () => {
    connect();
    change('Second');

    TestBed.resetTestingModule();
    vi.advanceTimersByTime(PREVIEW_DELAY_MS);

    expect(worker.updates).toEqual([ 'First' ]);
  });
});
