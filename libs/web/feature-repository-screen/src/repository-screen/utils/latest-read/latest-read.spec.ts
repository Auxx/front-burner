import { HttpErrorResponse } from '@angular/common/http';
import { type Observable, of, Subject, throwError } from 'rxjs';

import { LatestRead } from './latest-read';

const RETRY_MS = 1000;

describe('LatestRead', () => {
  let read: LatestRead;
  let next: ReturnType<typeof vi.fn<(value: number) => void>>;
  let error: ReturnType<typeof vi.fn<(error: unknown) => void>>;
  let start: ReturnType<typeof vi.fn<() => Observable<number>>>;

  beforeEach(() => {
    vi.useFakeTimers();
    read = new LatestRead(RETRY_MS);
    next = vi.fn();
    error = vi.fn();
    start = vi.fn(() => of(1));
  });

  afterEach(() => {
    read.cancel();
    vi.useRealTimers();
  });

  it('hands over the answer, and settles', async () => {
    await read.run(start, { next, error });

    expect(next).toHaveBeenCalledExactlyOnceWith(1);
    expect(error).not.toHaveBeenCalled();
  });

  it('a new read cancels the one still running, which settles', async () => {
    const running = new Subject<number>();
    const first = read.run(() => running, { next, error });

    await read.run(start, { next, error });
    await first;

    expect(running.observed).toBe(false);
    expect(next).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('tries a failed read again after the wait', async () => {
    start.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 500 })));

    await read.run(start, { next, error });

    expect(error).toHaveBeenCalledOnce();
    expect(next).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(RETRY_MS);

    expect(start).toHaveBeenCalledTimes(2);
    expect(next).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('does not try a refused read again', async () => {
    start.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 409 })));

    await read.run(start, { next, error });
    await vi.advanceTimersByTimeAsync(RETRY_MS);

    expect(error).toHaveBeenCalledOnce();
    expect(start).toHaveBeenCalledOnce();
  });

  it('cancel stops the wait to try again', async () => {
    start.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
    await read.run(start, { next, error });

    read.cancel();
    await vi.advanceTimersByTimeAsync(RETRY_MS);

    expect(start).toHaveBeenCalledOnce();
  });
});
