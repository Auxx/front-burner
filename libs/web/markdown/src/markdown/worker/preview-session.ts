import { splitBlocks } from '../blocks/split-blocks';
import { mergeRemovals, type RemovalKey, type RemovalReport } from '../pipeline/collect-removals';
import type { BlockRenderer, RenderedBlock } from '../render/render-block';
import type { PreviewLayoutBlock, PreviewResponse } from './preview-protocol';

/**
 * The preview worker's logic, without the worker (A-8.12, A-8.13). It
 * remembers the blocks of its last layout, which the page holds, and renders
 * only blocks that are new.
 */
export class PreviewSession {
  /** The removals of each block of the last layout: the page holds these blocks. */
  private known = new Map<string, RemovalReport>();

  constructor(private readonly renderer: BlockRenderer) {}

  async update(id: number, source: string): Promise<PreviewResponse> {
    try {
      const split = splitBlocks(source);
      const layout: PreviewLayoutBlock[] = split.blocks.map(({ key, fromLine, toLine }) => ({ key, fromLine, toLine }));
      const toRender = [ ...new Map(split.blocks.map(block => [ block.key, block ])).values() ]
        .filter(block => !this.known.has(block.key));
      const rendered: RenderedBlock[] = [];
      for (const block of toRender) {
        rendered.push(await this.renderer.render(block, split));
      }
      const footnotes = await this.renderer.renderFootnotes(split);
      if (footnotes) {
        const lastLine = split.blocks.at(-1)?.toLine ?? 1;
        layout.push({ key: footnotes.key, fromLine: lastLine, toLine: lastLine });
        if (!this.known.has(footnotes.key)) {
          rendered.push(footnotes);
        }
      }

      const known = new Map<string, RemovalReport>();
      for (const block of rendered) {
        known.set(block.key, new Map(block.removals));
      }
      for (const { key } of layout) {
        const removals = this.known.get(key);
        if (removals && !known.has(key)) {
          known.set(key, removals);
        }
      }
      this.known = known;

      const removals = mergeRemovals(layout.map(({ key }) => known.get(key) ?? new Map<RemovalKey, number>()));
      return { type: 'update', id, layout, rendered, removals: [ ...removals ], css: this.renderer.takeCss() };
    } catch (error) {
      return { type: 'error', id, message: error instanceof Error ? error.message : String(error) };
    }
  }

  /** Forgets the blocks, for a new file or a page that dropped its blocks: the next update renders every block. */
  reset(): void {
    this.known.clear();
  }
}
