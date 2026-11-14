import { type Extension } from '@codemirror/state';
import { type BlockInfo, BlockType, EditorView, gutter, GutterMarker } from '@codemirror/view';

/** A block taller than this many default lines is a wrapped line. */
const WRAPPED_LINES = 1.5;

class WrapMarker extends GutterMarker {
  override toDOM(): Node {
    const element = document.createElement('span');
    element.className = 'cm-wrap-marker';
    element.textContent = '↪';
    element.setAttribute('aria-hidden', 'true');
    return element;
  }
}

const marker = new WrapMarker();

/**
 * The height of a line's text: a block widget above or below it, such as the conflict
 * buttons, makes its block a composite, and its height is not the line's.
 */
function textHeight(block: BlockInfo): number {
  return Array.isArray(block.type)
    ? block.type.filter(part => part.type === BlockType.Text).reduce((sum, part) => sum + part.height, 0)
    : block.height;
}

/**
 * A narrow gutter after the line numbers that marks each line wrapped onto more than one row.
 * It is part of the soft-wrap extension, so it is gone while wrapping is off. CodeMirror's
 * gutters element is itself `aria-hidden`.
 */
export function wrapMarker(): Extension {
  return gutter({
    class: 'cm-wrapMarkers',
    // A hidden marker keeps the gutter at its width, so the text does not shift as lines wrap.
    initialSpacer: () => marker,
    lineMarker: (view: EditorView, line) =>
      textHeight(view.lineBlockAt(line.from)) > view.defaultLineHeight * WRAPPED_LINES
        ? marker
        : null,
    lineMarkerChange: update => update.geometryChanged || update.docChanged
  });
}
