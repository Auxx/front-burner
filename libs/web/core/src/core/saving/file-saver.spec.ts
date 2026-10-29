import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';

import { FileSaver } from './file-saver';
import type { SaveResult } from './save-status.model';

/** A request of the fake `send`, answered by the test. */
interface Sent {
  content: string;
  resolve(result: SaveResult): void;
  reject(error: unknown): void;
}

function httpError(status: number, code?: string): HttpErrorResponse {
  return new HttpErrorResponse({
    status,
    headers: new HttpHeaders(),
    error: code === undefined ? null : { code, params: {}, requestId: 'r1', message: code }
  });
}

describe('FileSaver', () => {
  let sent: Sent[];
  let saver: FileSaver;
  let content: string;

  const settle = () => vi.advanceTimersByTimeAsync(0);

  function type(text: string): void {
    content = text;
    saver.edit(() => content);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    sent = [];
    content = 'start';
    saver = new FileSaver({
      lastSaved: 'start',
      send: text =>
        new Promise<SaveResult>((resolve, reject) => {
          sent.push({ content: text, resolve, reject });
        })
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('AC-EDIT-001.3: sends 1.5 s after the last edit', async () => {
    type('a');
    await vi.advanceTimersByTimeAsync(1000);
    type('ab');
    await vi.advanceTimersByTimeAsync(1499);
    expect(sent).toHaveLength(0);
    expect(saver.status()).toEqual({ kind: 'saving' });
    expect(saver.unsaved()).toBe(true);

    await vi.advanceTimersByTimeAsync(1);
    expect(sent.map(item => item.content)).toEqual([ 'ab' ]);

    const saved = vi.fn<(result: SaveResult) => void>();
    saver.saved.subscribe(saved);
    sent[0].resolve({ hash: 'h1' });
    await settle();
    expect(saver.status()).toEqual({ kind: 'saved' });
    expect(saver.unsaved()).toBe(false);
    expect(saver.lastSaved()).toEqual({ content: 'ab', hash: 'h1' });
    expect(saved).toHaveBeenCalledWith({ hash: 'h1' });
  });

  it('sends only the newest content after the save in flight', async () => {
    type('a');
    await vi.advanceTimersByTimeAsync(1500);
    expect(sent).toHaveLength(1);

    for (const text of [ 'ab', 'abc', 'abcd' ]) {
      type(text);
      await vi.advanceTimersByTimeAsync(600);
    }
    await vi.advanceTimersByTimeAsync(1500);
    // One save in flight at a time.
    expect(sent).toHaveLength(1);

    sent[0].resolve({ hash: 'h1' });
    await settle();
    expect(sent.map(item => item.content)).toEqual([ 'a', 'abcd' ]);
    expect(saver.status()).toEqual({ kind: 'saving' });

    sent[1].resolve({ hash: 'h2' });
    await settle();
    await vi.advanceTimersByTimeAsync(5000);
    expect(sent).toHaveLength(2);
    expect(saver.status()).toEqual({ kind: 'saved' });
    expect(saver.unsaved()).toBe(false);
  });

  it('tells the content of each save as it is sent', async () => {
    const sending: string[] = [];
    saver.sending.subscribe(text => sending.push(text));
    type('a');
    await vi.advanceTimersByTimeAsync(1500);
    type('ab');
    expect(sending).toEqual([ 'a' ]);

    sent[0].reject(new Error('offline'));
    await settle();
    await vi.advanceTimersByTimeAsync(1000);

    expect(sending).toEqual([ 'a', 'ab' ]);
  });

  it('reports a confirmed save once it knows whether newer content waits', async () => {
    const unsavedWhenSaved: boolean[] = [];
    saver.saved.subscribe(() => unsavedWhenSaved.push(saver.unsaved()));
    type('a');
    await vi.advanceTimersByTimeAsync(1500);
    type('ab');
    sent[0].resolve({ hash: 'h1' });
    await settle();
    await vi.advanceTimersByTimeAsync(1500);
    sent[1].resolve({ hash: 'h2' });
    await settle();

    expect(unsavedWhenSaved).toEqual([ true, false ]);
  });

  it('reports being up to date when the newest content is saved', async () => {
    const upToDate = vi.fn();
    saver.upToDate.subscribe(upToDate);
    type('a');
    await vi.advanceTimersByTimeAsync(1500);
    type('ab');
    sent[0].resolve({ hash: 'h1' });
    await settle();
    expect(upToDate).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1500);
    sent[1].resolve({ hash: 'h2' });
    await settle();
    expect(upToDate).toHaveBeenCalledOnce();
  });

  it('reports being up to date when the edits are undone back to the saved content', async () => {
    const upToDate = vi.fn();
    saver.upToDate.subscribe(upToDate);
    type('a');
    await vi.advanceTimersByTimeAsync(1500);
    sent[0].reject(httpError(413, 'file-too-large'));
    await settle();

    type('start');
    await vi.advanceTimersByTimeAsync(1500);

    expect(sent).toHaveLength(1);
    expect(saver.unsaved()).toBe(false);
    expect(upToDate).toHaveBeenCalledOnce();
  });

  it('does not report being up to date on discard', async () => {
    const upToDate = vi.fn();
    saver.upToDate.subscribe(upToDate);
    type('a');

    saver.discard();

    expect(upToDate).not.toHaveBeenCalled();
  });

  it('reads the waiting content without sending it', async () => {
    expect(saver.waiting()).toBeNull();
    type('a');

    expect(saver.waiting()).toBe('a');
    await vi.advanceTimersByTimeAsync(1500);
    // In flight, no longer waiting.
    expect(saver.waiting()).toBeNull();
  });

  it('sends nothing when the content equals the last save', async () => {
    type('changed');
    type('start');
    await vi.advanceTimersByTimeAsync(1500);
    expect(sent).toHaveLength(0);
    expect(saver.status()).toEqual({ kind: 'saved' });
    expect(saver.unsaved()).toBe(false);
  });

  it('AC-EDIT-001.5: retries until the backend answers', async () => {
    const statuses: string[] = [];
    type('a');
    statuses.push(saver.status().kind);
    await vi.advanceTimersByTimeAsync(1500);

    sent[0].reject(httpError(0));
    await settle();
    statuses.push(saver.status().kind);

    // Retried after 1, 2, 4, 8, 16 and then every 30 s.
    const waits = [ 1000, 2000, 4000, 8000, 16_000, 30_000, 30_000 ];
    for (const [ index, wait ] of waits.entries()) {
      await vi.advanceTimersByTimeAsync(wait - 1);
      expect(sent).toHaveLength(index + 1);
      await vi.advanceTimersByTimeAsync(1);
      expect(sent).toHaveLength(index + 2);
      sent[index + 1].reject(index % 2 === 0 ? httpError(503, 'internal') : new TypeError('Failed to fetch'));
      await settle();
      expect(saver.status()).toEqual({ kind: 'offline' });
    }

    // Typing meanwhile: the retry sends the newest content.
    type('ab');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(sent.at(-1)?.content).toBe('ab');
    sent.at(-1)?.resolve({ hash: 'h1' });
    await settle();
    statuses.push(saver.status().kind);
    expect(statuses).toEqual([ 'saving', 'offline', 'saved' ]);
    expect(saver.unsaved()).toBe(false);
  });

  it('does not retry a refusal and tries again after the next edit', async () => {
    type('too large');
    await vi.advanceTimersByTimeAsync(1500);
    sent[0].reject(httpError(413, 'file-too-large'));
    await settle();
    expect(saver.status()).toMatchObject({
      kind: 'refused',
      code: 'file-too-large',
      error: { code: 'file-too-large' }
    });
    expect(saver.unsaved()).toBe(true);

    await vi.advanceTimersByTimeAsync(120_000);
    await saver.flush();
    expect(sent).toHaveLength(1);

    type('small');
    expect(saver.status()).toEqual({ kind: 'saving' });
    await vi.advanceTimersByTimeAsync(1500);
    expect(sent.map(item => item.content)).toEqual([ 'too large', 'small' ]);
    sent[1].resolve({ hash: 'h1' });
    await settle();
    expect(saver.status()).toEqual({ kind: 'saved' });
  });

  it('backs off after a failed save during which the delay ended, then saves edits 1.5 s after them', async () => {
    type('a');
    await vi.advanceTimersByTimeAsync(1500);
    type('ab');
    await vi.advanceTimersByTimeAsync(1500);
    expect(sent).toHaveLength(1);

    sent[0].reject(httpError(0));
    await settle();
    // Not at once: after the first retry delay.
    expect(sent).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(sent.map(item => item.content)).toEqual([ 'a', 'ab' ]);

    sent[1].resolve({ hash: 'h1' });
    await settle();
    type('abc');
    await vi.advanceTimersByTimeAsync(1500);
    expect(sent.map(item => item.content)).toEqual([ 'a', 'ab', 'abc' ]);
  });

  it.each([ 408, 429 ])('retries a save answered with %i', async status => {
    type('a');
    await vi.advanceTimersByTimeAsync(1500);
    sent[0].reject(httpError(status, 'internal'));
    await settle();
    expect(saver.status()).toEqual({ kind: 'offline' });

    await vi.advanceTimersByTimeAsync(1000);
    expect(sent).toHaveLength(2);
  });

  it('sends nothing while held, and the waiting save once released', async () => {
    type('a');
    await vi.advanceTimersByTimeAsync(1500);
    sent[0].reject(httpError(0));
    await settle();

    const release = saver.hold();
    type('ab');
    await vi.advanceTimersByTimeAsync(60_000);
    await saver.flush();
    expect(sent).toHaveLength(1);

    release();
    release();
    await settle();
    expect(sent.map(item => item.content)).toEqual([ 'a', 'ab' ]);
  });

  it('flush sends at once and waits', async () => {
    type('a');
    let flushed = false;
    const flushing = saver.flush().then(() => (flushed = true));
    await settle();
    expect(sent.map(item => item.content)).toEqual([ 'a' ]);
    expect(flushed).toBe(false);

    sent[0].resolve({ hash: 'h1' });
    await flushing;
    expect(flushed).toBe(true);
    expect(saver.status()).toEqual({ kind: 'saved' });
  });

  it('flush waits for the save in flight and the newest content after it', async () => {
    type('a');
    await vi.advanceTimersByTimeAsync(1500);
    type('ab');
    let flushed = false;
    const flushing = saver.flush().then(() => (flushed = true));
    await settle();
    expect(sent).toHaveLength(1);

    sent[0].resolve({ hash: 'h1' });
    await settle();
    expect(sent.map(item => item.content)).toEqual([ 'a', 'ab' ]);
    expect(flushed).toBe(false);

    sent[1].resolve({ hash: 'h2' });
    await flushing;
    expect(saver.lastSaved()).toEqual({ content: 'ab', hash: 'h2' });
  });

  it('flush resolves when the save fails, and leaves it to the retries', async () => {
    type('a');
    const flushing = saver.flush();
    await settle();
    sent[0].reject(httpError(0));
    await flushing;
    expect(saver.status()).toEqual({ kind: 'offline' });

    await vi.advanceTimersByTimeAsync(1000);
    expect(sent).toHaveLength(2);
  });

  it('flush with nothing waiting resolves at once', async () => {
    await saver.flush();
    expect(sent).toHaveLength(0);
  });

  it('discard drops the waiting save', async () => {
    type('a');
    saver.discard();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sent).toHaveLength(0);
    expect(saver.unsaved()).toBe(false);
  });

  it('does not retry a save in flight that was discarded', async () => {
    type('a');
    await vi.advanceTimersByTimeAsync(1500);
    saver.discard();
    sent[0].reject(httpError(503, 'internal'));
    await settle();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(sent).toHaveLength(1);
    expect(saver.unsaved()).toBe(false);
    expect(saver.status()).toEqual({ kind: 'saved' });
  });

  it('discard stops the retries', async () => {
    type('a');
    await vi.advanceTimersByTimeAsync(1500);
    sent[0].reject(httpError(0));
    await settle();
    saver.discard();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sent).toHaveLength(1);
  });
});
