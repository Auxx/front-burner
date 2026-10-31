import { StateEffect } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEditorState, setSoftWrap } from './editor-state';

const LINE_HEIGHT = 20;
const LONG = 'x'.repeat(500);

// jsdom has no layout, so the heights of the line blocks are stubbed: a line is as tall as the
// number of rows that `rowsOf` says it wraps to.
function stubHeights(view: EditorView, rowsOf: (text: string) => number): void {
  vi.spyOn(view, 'defaultLineHeight', 'get').mockReturnValue(LINE_HEIGHT);
  vi.spyOn(view, 'lineBlockAt').mockImplementation((pos: number) => {
    const line = view.state.doc.lineAt(pos);
    return { height: rowsOf(line.text) * LINE_HEIGHT } as ReturnType<EditorView['lineBlockAt']>;
  });
}

function markers(view: EditorView): string[] {
  // The first element is the hidden spacer that keeps the gutter's width.
  const elements = Array.from(view.dom.querySelectorAll('.cm-wrapMarkers .cm-gutterElement'))
    .filter(el => (el as HTMLElement).style.visibility !== 'hidden');
  return elements.flatMap(el => Array.from(el.querySelectorAll('.cm-wrap-marker'))).map(el => el.textContent ?? '');
}

describe('wrapMarker', () => {
  afterEach(() => vi.restoreAllMocks());

  function open(): EditorView {
    const view = new EditorView({
      state: createEditorState({ content: `short\n${LONG}`, highlight: false, label: 'a.md' })
    });
    document.body.append(view.dom);
    return view;
  }

  it('marks only the lines taller than one line, after the line numbers', () => {
    const view = open();
    stubHeights(view, text => (text.length > 100 ? 5 : 1));
    view.dispatch({ changes: { from: 0, insert: 'a' } });

    const gutters = Array.from(view.dom.querySelectorAll('.cm-gutters > .cm-gutter')).map(g => g.className);
    expect(gutters.findIndex(c => c.includes('cm-lineNumbers'))).toBeLessThan(
      gutters.findIndex(c => c.includes('cm-wrapMarkers'))
    );
    expect(markers(view)).toEqual([ '↪' ]);
    expect(view.dom.querySelector('.cm-wrap-marker')?.getAttribute('aria-hidden')).toBe('true');
    view.destroy();
  });

  it('updates the marked lines when the geometry changes', async () => {
    const view = open();
    let wide = true;
    stubHeights(view, text => (!wide && text.length > 100 ? 5 : 1));
    view.dispatch({ changes: { from: 0, insert: 'a' } });
    expect(markers(view)).toEqual([]);

    wide = false;
    // A resize makes CodeMirror's measure report a geometry change (flag 16), without any edit.
    // jsdom has no layout, so the measure is stubbed to report it once.
    const geometry = 16;
    vi.spyOn(view.viewState, 'measure').mockReturnValueOnce(geometry);
    let geometryChanged = false;
    view.dispatch({
      effects: StateEffect.appendConfig.of(EditorView.updateListener.of(u => (geometryChanged ||= u.geometryChanged)))
    });
    view.measure();
    expect(geometryChanged).toBe(true);
    expect(markers(view)).toEqual([ '↪' ]);
    view.destroy();
  });

  it('keeps the gutter width with a spacer when no line wraps', () => {
    const view = open();
    stubHeights(view, () => 1);
    view.dispatch({ changes: { from: 0, insert: 'a' } });
    expect(markers(view)).toEqual([]);
    const spacer = view.dom.querySelector('.cm-wrapMarkers .cm-gutterElement');
    expect(spacer?.querySelector('.cm-wrap-marker')).not.toBeNull();
    expect((spacer as HTMLElement).style.visibility).toBe('hidden');
    view.destroy();
  });

  it('has no marker gutter when soft wrap is off', () => {
    const view = open();
    view.dispatch(setSoftWrap(false));
    expect(view.dom.querySelector('.cm-wrapMarkers')).toBeNull();
    view.dispatch(setSoftWrap(true));
    expect(view.dom.querySelector('.cm-wrapMarkers')).not.toBeNull();
    view.destroy();
  });
});
