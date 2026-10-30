import { blockAtLine, scrollTopOf, topPlace } from './preview-lines';

/**
 * A container of blocks given as `[fromLine, toLine, height]`, stacked from
 * the top, with a layout that follows `scrollTop` (jsdom has none).
 */
function preview(blocks: [ number, number, number ][]): HTMLElement {
  const container = document.createElement('div');
  // jsdom does not scroll.
  Object.defineProperty(container, 'scrollTop', { writable: true, value: 0 });
  let offset = 0;
  for (const [ from, to, height ] of blocks) {
    const block = document.createElement('div');
    block.setAttribute('data-from-line', String(from));
    block.setAttribute('data-to-line', String(to));
    const top = offset;
    block.getBoundingClientRect = () => rect(top - container.scrollTop, height);
    container.append(block);
    offset += height;
  }
  container.getBoundingClientRect = () => rect(0, 300);
  return container;
}

function rect(top: number, height: number): DOMRect {
  return { top, height, bottom: top + height, left: 0, right: 0, width: 0, x: 0, y: top, toJSON: () => ({}) };
}

const lines = (block: Element | null) => [ block?.getAttribute('data-from-line'), block?.getAttribute('data-to-line') ];

describe('preview lines', () => {
  it('finds the block holding a line', () => {
    const container = preview([ [ 1, 1, 40 ], [ 3, 7, 100 ], [ 9, 9, 40 ] ]);

    expect(lines(blockAtLine(container, 1))).toEqual([ '1', '1' ]);
    expect(lines(blockAtLine(container, 5))).toEqual([ '3', '7' ]);
    expect(lines(blockAtLine(container, 9))).toEqual([ '9', '9' ]);
    expect(blockAtLine(document.createElement('div'), 1)).toBeNull();
  });

  it('uses the nearest block when the line\'s block is missing', () => {
    // Lines 10 to 39 are a block that has not rendered yet.
    const container = preview([ [ 3, 7, 100 ], [ 40, 42, 60 ] ]);

    expect(lines(blockAtLine(container, 1))).toEqual([ '3', '7' ]);
    expect(lines(blockAtLine(container, 12))).toEqual([ '3', '7' ]);
    expect(lines(blockAtLine(container, 30))).toEqual([ '40', '42' ]);
    expect(lines(blockAtLine(container, 99))).toEqual([ '40', '42' ]);
  });

  it('maps the last line to the last block, not to the footnote list after it', () => {
    // The footnote list is laid out at the last block's last line.
    const container = preview([ [ 1, 1, 40 ], [ 40, 42, 60 ], [ 42, 42, 80 ] ]);

    expect(blockAtLine(container, 42)).toBe(container.children[1]);
  });

  it('reads the place at the top as a block and a share of it', () => {
    const container = preview([ [ 1, 1, 40 ], [ 3, 6, 100 ], [ 8, 8, 40 ] ]);

    expect(topPlace(container)).toBe(1);
    container.scrollTop = 90;

    // 50 of the second block's 100 px: half of its four lines.
    expect(topPlace(container)).toBe(5);
  });

  it('scrolls to a line and a share of its block', () => {
    const container = preview([ [ 1, 1, 40 ], [ 3, 6, 100 ], [ 8, 8, 40 ] ]);

    expect(scrollTopOf(container, 3)).toBe(40);
    expect(scrollTopOf(container, 5)).toBe(90);
    expect(scrollTopOf(container, 8.5)).toBe(160);
    expect(scrollTopOf(document.createElement('div'), 3)).toBeNull();
  });
});
