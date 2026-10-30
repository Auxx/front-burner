import type { PreviewState } from '../../services/preview-renderer/preview-renderer.service';
import { patchBlocks } from './patch-blocks';

/** A state whose blocks are `[key, html]` pairs, one line each. */
function state(blocks: [ string, string ][]): PreviewState {
  return {
    layout: blocks.map(([ key ], index) => ({ key, fromLine: index + 1, toLine: index + 1 })),
    rendered: new Map(blocks),
    removals: new Map(),
    id: 1
  };
}

describe('patchBlocks', () => {
  let container: HTMLElement;
  let purified: string[];
  const purify = (html: string) => {
    purified.push(html);
    return html;
  };

  beforeEach(() => {
    container = document.createElement('div');
    purified = [];
  });

  const texts = () => Array.from(container.children, child => child.textContent);

  it('renders the blocks in layout order', () => {
    patchBlocks(container, state([ [ 'a', '<p>A</p>' ], [ 'b', '<p>B</p>' ], [ 'c', '<p>C</p>' ] ]), purify);

    expect(texts()).toEqual([ 'A', 'B', 'C' ]);
    const block = container.children[1] as HTMLElement;
    expect(block.className).toBe('md-block');
    expect(block.dataset['fromLine']).toBe('2');
    expect(block.dataset['toLine']).toBe('2');
  });

  it('replaces only the changed block\'s element', () => {
    patchBlocks(container, state([ [ 'a', '<p>A</p>' ], [ 'b', '<p>B</p>' ], [ 'c', '<p>C</p>' ] ]), purify);
    const [ first, , last ] = Array.from(container.children);
    const observer = new MutationObserver(() => undefined);
    observer.observe(first, { subtree: true, childList: true, attributes: true, characterData: true });

    patchBlocks(container, state([ [ 'a', '<p>A</p>' ], [ 'b2', '<p>B, edited</p>' ], [ 'c', '<p>C</p>' ] ]), purify);

    expect(texts()).toEqual([ 'A', 'B, edited', 'C' ]);
    expect(container.children[0]).toBe(first);
    expect(container.children[2]).toBe(last);
    expect(observer.takeRecords()).toEqual([]);
  });

  it('returns the elements it created and removed', () => {
    const first = patchBlocks(container, state([ [ 'a', '<p>A</p>' ], [ 'b', '<p>B</p>' ] ]), purify);
    const [ a, b ] = Array.from(container.children);

    expect(first).toEqual({ added: [ a, b ], removed: [] });
    const second = patchBlocks(container, state([ [ 'a', '<p>A</p>' ], [ 'c', '<p>C</p>' ] ]), purify);
    expect(second).toEqual({ added: [ container.children[1] ], removed: [ b ] });
  });

  it('removes blocks that are gone', () => {
    patchBlocks(container, state([ [ 'a', '<p>A</p>' ], [ 'b', '<p>B</p>' ] ]), purify);

    patchBlocks(container, state([ [ 'b', '<p>B</p>' ] ]), purify);

    expect(texts()).toEqual([ 'B' ]);
    expect((container.children[0] as HTMLElement).dataset['fromLine']).toBe('1');
  });

  it('keeps one element per block when two blocks are the same', () => {
    patchBlocks(container, state([ [ 'a', '<hr>' ], [ 'b', '<p>B</p>' ], [ 'a', '<hr>' ] ]), purify);

    expect(container.children).toHaveLength(3);
    expect(container.querySelectorAll('hr')).toHaveLength(2);
  });

  it('purifies only new blocks', () => {
    patchBlocks(container, state([ [ 'a', '<p>A</p>' ], [ 'b', '<p>B</p>' ] ]), purify);
    purified = [];

    patchBlocks(container, state([ [ 'a', '<p>A</p>' ], [ 'b', '<p>B</p>' ], [ 'c', '<p>C</p>' ] ]), purify);

    expect(purified).toEqual([ '<p>C</p>' ]);
  });

  it('numbers duplicate heading IDs in document order', () => {
    patchBlocks(
      container,
      state([
        [ 'a', '<h2 id="user-content-install">Install</h2>' ],
        [ 'b', '<h2 id="user-content-install">Install</h2><h3 id="user-content-install-1">Install</h3>' ]
      ]),
      purify
    );

    expect(Array.from(container.querySelectorAll('h2, h3'), heading => heading.id)).toEqual([
      'user-content-install',
      'user-content-install-1',
      'user-content-install-1-1'
    ]);

    patchBlocks(
      container,
      state([
        [ 'z', '<h2 id="user-content-install">Install</h2>' ],
        [ 'a', '<h2 id="user-content-install">Install</h2>' ]
      ]),
      purify
    );

    expect(Array.from(container.querySelectorAll('h2'), heading => heading.id)).toEqual([
      'user-content-install',
      'user-content-install-1'
    ]);
    expect(container.children[0].textContent).toBe('Install');
  });

  it('sets dir auto on every block', () => {
    patchBlocks(container, state([ [ 'a', '<p>A</p>' ], [ 'b', '<p>مرحبا</p>' ] ]), purify);

    expect(Array.from(container.children, child => child.getAttribute('dir'))).toEqual([ 'auto', 'auto' ]);
  });

  it('opens http, https and mailto in a new tab without a referrer or opener', () => {
    patchBlocks(
      container,
      state([
        [ 'a', '<p><a href="https://example.com">x</a><a href="mailto:a@example.com">y</a><a href="b.md">z</a></p>' ]
      ]),
      purify
    );

    const links = Array.from(container.querySelectorAll('a'));
    expect(links.map(link => [ link.getAttribute('target'), link.getAttribute('rel') ])).toEqual([
      [ '_blank', 'noopener noreferrer' ],
      [ '_blank', 'noopener noreferrer' ],
      [ null, null ]
    ]);
  });

  it('names a task list\'s checkbox by its item', () => {
    patchBlocks(
      container,
      state([ [
        'a',
        '<ul><li class="task-list-item"><input type="checkbox" checked disabled> Write the  plan</li></ul>'
      ] ]),
      purify
    );

    expect(container.querySelector('input')?.getAttribute('aria-label')).toBe('Write the plan');
  });

  it('lets the keyboard reach code blocks and tables, which scroll sideways', () => {
    patchBlocks(
      container,
      state([ [ 'a', '<pre><code>x</code></pre>' ], [ 'b', '<table><tr><td>1</td></tr></table>' ] ]),
      purify
    );

    expect(Array.from(container.querySelectorAll('pre, table'), element => element.getAttribute('tabindex')))
      .toEqual([ '0', '0' ]);
  });
});
