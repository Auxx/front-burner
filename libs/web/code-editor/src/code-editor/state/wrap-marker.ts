import { type Extension } from '@codemirror/state';
import { EditorView, gutter, GutterMarker } from '@codemirror/view';

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
 * A narrow gutter after the line numbers that marks each line wrapped onto more than one row.
 * It is part of the soft-wrap extension, so it is gone while wrapping is off. CodeMirror's
 * gutters element is itself `aria-hidden`.
 */
export function wrapMarker(): Extension {
  return gutter({
    class: 'cm-wrapMarkers',
    lineMarker: (view: EditorView, line) =>
      view.lineBlockAt(line.from).height > view.defaultLineHeight * WRAPPED_LINES ? marker : null,
    lineMarkerChange: update => update.geometryChanged || update.docChanged
  });
}
