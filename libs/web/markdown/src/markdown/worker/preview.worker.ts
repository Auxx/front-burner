/// <reference lib="webworker" />
import { createBlockRenderer } from '../render/render-block';
import type { PreviewRequest, PreviewResponse } from './preview-protocol';
import { PreviewSession } from './preview-session';

// The preview worker (A-8.13): remark, the first sanitising step and Shiki,
// off the main thread. Requests are handled one at a time, in order; an update
// that a newer one has already overtaken is skipped, as its answer would be
// dropped anyway.

const session = createBlockRenderer().then(renderer => new PreviewSession(renderer));
let queue = Promise.resolve();
let latest = 0;

addEventListener('message', ({ data }: MessageEvent<PreviewRequest>) => {
  if (data.type === 'update') {
    latest = data.id;
  }
  queue = queue.then(async () => {
    const current = await session;
    if (data.type === 'reset') {
      current.reset();
      return;
    }
    if (data.id < latest) {
      return;
    }
    postMessage(await current.update(data.id, data.source) satisfies PreviewResponse);
  });
});
