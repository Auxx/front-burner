import { type ScrollPane, ScrollSync } from './scroll-sync';

function pane(): ScrollPane & { places: number[]; } {
  const places: number[] = [];
  return { element: document.createElement('div'), places, scrollToLine: place => places.push(place) };
}

describe('ScrollSync', () => {
  let sync: ScrollSync;
  let editor: ReturnType<typeof pane>;
  let preview: ReturnType<typeof pane>;
  let disconnect: () => void;

  beforeEach(() => {
    sync = new ScrollSync();
    editor = pane();
    preview = pane();
    disconnect = sync.connect(editor, preview);
  });

  it('scrolls the preview with the editor', () => {
    editor.element.dispatchEvent(new WheelEvent('wheel'));

    sync.scrolled(editor, 12.5);

    expect(preview.places).toEqual([ 12.5 ]);
    expect(editor.places).toEqual([]);
  });

  it('scrolls the editor with the preview', () => {
    preview.element.dispatchEvent(new Event('touchstart'));

    sync.scrolled(preview, 7);

    expect(editor.places).toEqual([ 7 ]);
  });

  it('does not sync a scroll it caused', () => {
    editor.element.dispatchEvent(new KeyboardEvent('keydown'));
    sync.scrolled(editor, 12.5);

    // The preview's own scroll, and more of them as a scroll glides.
    sync.scrolled(preview, 12.4);
    sync.scrolled(preview, 12.6);

    expect(editor.places).toEqual([]);
  });

  it('follows the pane the user scrolls last', () => {
    editor.element.dispatchEvent(new WheelEvent('wheel'));
    sync.scrolled(editor, 3);
    preview.element.dispatchEvent(new Event('pointerdown'));

    sync.scrolled(preview, 9);
    sync.scrolled(editor, 9.1);

    expect(editor.places).toEqual([ 9 ]);
    expect(preview.places).toEqual([ 3 ]);
  });

  it('syncs nothing before the user scrolls, or once disconnected', () => {
    sync.scrolled(editor, 4);
    disconnect();
    editor.element.dispatchEvent(new WheelEvent('wheel'));
    sync.scrolled(editor, 5);

    expect(preview.places).toEqual([]);
  });
});
