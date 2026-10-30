import { RangeSetBuilder } from '@codemirror/state';
import { Decoration, type DecorationSet, type EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';

const autoDirection = Decoration.line({ attributes: { dir: 'auto' } });

/**
 * Gives every visible line `dir="auto"`, so that a right-to-left line is shown
 * right to left (ED-30, NF-14.4). `EditorView.perLineTextDirection` only reads
 * each line's CSS direction; this sets it. Only the lines in the viewport are
 * decorated, so a large file costs no more than a small one. The typing test
 * (`tools/ai-tools/src/typing-test/page.mjs`) measures a copy of it.
 */
export const lineDirection = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = decorate(view);
    }

    update(update: ViewUpdate): void {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = decorate(update.view);
      }
    }
  },
  { decorations: plugin => plugin.decorations }
);

function decorate(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    for (let position = from; position <= to;) {
      const line = view.state.doc.lineAt(position);
      builder.add(line.from, line.from, autoDirection);
      position = line.to + 1;
    }
  }
  return builder.finish();
}
