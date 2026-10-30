import {
  DestroyRef,
  effect,
  inject,
  Injectable,
  InjectionToken,
  Injector,
  type Signal,
  signal,
  untracked
} from '@angular/core';
import type { RemovalReport } from '../../pipeline/collect-removals';
import { createPreviewWorker } from '../../worker/create-preview-worker';
import type { PreviewLayoutBlock, PreviewRequest, PreviewResponse } from '../../worker/preview-protocol';

/** Starts a preview worker; tests provide a fake. */
export const PREVIEW_WORKER = new InjectionToken<() => Worker>('PREVIEW_WORKER', {
  factory: () => createPreviewWorker
});

/** How long the preview waits after the last change (A-8.12). */
export const PREVIEW_DELAY_MS = 100;
/** The wait for files above `PREVIEW_LARGE_FILE` characters. */
export const PREVIEW_LARGE_DELAY_MS = 1000;
/** 256 KB _(A-8.12: a margin above NF-2.5's 200 KB)_. */
export const PREVIEW_LARGE_FILE = 256 * 1024;

/**
 * The text the preview shows. The editor bumps `version` on each change; the
 * text is read only when the wait ends, so typing never copies a large file
 * (NF-2.4).
 */
export interface PreviewSource {
  version: Signal<number>;
  read: () => string;
}

/** What the preview component shows. */
export interface PreviewState {
  /** The blocks in file order. */
  layout: readonly PreviewLayoutBlock[];
  /** The HTML of every block of the layout, by key: sanitised once, not yet by DOMPurify. */
  rendered: ReadonlyMap<string, string>;
  /** What was removed from the whole file (SH-17). */
  removals: RemovalReport;
  /** The update this state answers. */
  id: number;
}

/**
 * Renders the preview in a Web Worker (A-8.12, A-8.13). It waits until
 * typing stops, sends the text, and shows only the answer to its latest
 * update; HTML from an overtaken answer is kept, since the worker will not
 * send those blocks again. Provided by each preview; the worker ends with it.
 */
@Injectable()
export class PreviewRendererService {
  private readonly injector = inject(Injector);
  private readonly startWorker = inject(PREVIEW_WORKER);

  private readonly state = signal<PreviewState | null>(null);

  private worker: Worker | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** The id of the latest update sent. */
  private latest = 0;
  /** The id of the latest update answered, with blocks or an error. */
  private answered = 0;
  /** Answers to updates before this id came before a reset, and are dropped whole. */
  private resetAt = 0;
  private rendered = new Map<string, string>();
  private length = 0;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      clearTimeout(this.timer);
      this.worker?.terminate();
      this.worker = undefined;
    });
  }

  /**
   * Follows a source: renders it at once, then after each change once typing
   * stops. Given a signal of sources, such as a file's when another file is
   * opened, it forgets the blocks and renders the new source at once.
   *
   * While `active` is false, such as for a preview that is not on screen, it
   * neither reads the text nor renders (A-8.12); becoming active renders the
   * newest text at once, if it changed meanwhile.
   */
  connect(
    source: PreviewSource | Signal<PreviewSource>,
    active: Signal<boolean> = signal(true)
  ): Signal<PreviewState | null> {
    let connected: PreviewSource | null = null;
    /** The version of the connected source last sent, or `null` when nothing of it was. */
    let sent: number | null = null;
    let wasActive = false;
    effect(() => {
      const current = typeof source === 'function' ? source() : source;
      const version = current.version();
      const on = active();
      untracked(() => {
        const activated = on && !wasActive;
        wasActive = on;
        clearTimeout(this.timer);
        this.timer = undefined;
        if (current !== connected) {
          if (connected !== null) {
            this.reset();
          }
          connected = current;
          sent = null;
        }
        if (!on) {
          return;
        }
        if (sent === null || (activated && sent !== version)) {
          sent = version;
          this.send(current.read());
          return;
        }
        if (sent === version) {
          return;
        }
        const delay = this.length > PREVIEW_LARGE_FILE ? PREVIEW_LARGE_DELAY_MS : PREVIEW_DELAY_MS;
        this.timer = setTimeout(() => {
          this.timer = undefined;
          sent = current.version();
          this.send(current.read());
        }, delay);
      });
    }, { injector: this.injector });
    return this.state.asReadonly();
  }

  /** Whether newer text than the state shows is waiting or being rendered. */
  busy(): boolean {
    return this.timer !== undefined || this.answered !== this.latest;
  }

  /** Forgets the blocks, as for another file: the next update renders every block. */
  reset(): void {
    this.post({ type: 'reset' });
    this.resetAt = this.latest + 1;
    this.rendered = new Map();
    this.state.set(null);
  }

  private send(text: string): void {
    this.length = text.length;
    this.latest++;
    this.post({ type: 'update', id: this.latest, source: text });
  }

  private post(request: PreviewRequest): void {
    if (!this.worker) {
      this.worker = this.startWorker();
      this.worker.addEventListener('message', ({ data }: MessageEvent<PreviewResponse>) => this.receive(data));
    }
    this.worker.postMessage(request);
  }

  private receive(response: PreviewResponse): void {
    if (response.id < this.resetAt) {
      return;
    }
    this.answered = Math.max(this.answered, response.id);
    if (response.type === 'error') {
      // The preview keeps showing the last version that rendered.
      console.error('The preview could not be rendered:', response.message);
      return;
    }
    for (const block of response.rendered) {
      this.rendered.set(block.key, block.html);
    }
    if (response.id !== this.latest) {
      return;
    }
    const rendered = new Map<string, string>();
    for (const { key } of response.layout) {
      const html = this.rendered.get(key);
      if (html !== undefined) {
        rendered.set(key, html);
      }
    }
    this.rendered = rendered;
    this.state.set({
      layout: response.layout,
      rendered,
      removals: new Map(response.removals),
      id: response.id
    });
  }
}
