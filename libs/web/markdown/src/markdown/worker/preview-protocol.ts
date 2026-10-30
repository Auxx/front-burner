import type { RemovalKey } from '../pipeline/collect-removals';
import type { RenderedBlock } from '../render/render-block';

/** What the main thread asks the preview worker: render a version of the file, or forget the blocks it sent. */
export type PreviewRequest =
  | { type: 'update'; id: number; source: string; }
  | { type: 'reset'; };

/** A block of the layout, in file order; its HTML is sent once and kept by the page. */
export interface PreviewLayoutBlock {
  key: string;
  fromLine: number;
  toLine: number;
}

/** The worker's answer to an update. */
export type PreviewResponse =
  | {
    type: 'update';
    id: number;
    layout: PreviewLayoutBlock[];
    /** Only the blocks that the page does not hold yet. */
    rendered: RenderedBlock[];
    /** What was removed from the whole file (SH-17). */
    removals: [ RemovalKey, number ][];
    /** The rules of new highlighting classes. */
    css: string;
  }
  | { type: 'error'; id: number; message: string; };
