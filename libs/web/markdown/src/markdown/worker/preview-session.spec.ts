import type { SourceBlock, SplitSource } from '../blocks/split-blocks';
import { type BlockRenderer, createBlockRenderer } from '../render/render-block';
import type { PreviewResponse } from './preview-protocol';
import { PreviewSession } from './preview-session';

type UpdateResponse = Extract<PreviewResponse, { type: 'update'; }>;

describe('PreviewSession', () => {
  let renderer: BlockRenderer;
  let rendered: string[];
  let session: PreviewSession;

  beforeAll(async () => {
    const real = await createBlockRenderer();
    renderer = {
      render: (block: SourceBlock, split: SplitSource) => {
        rendered.push(block.text);
        return real.render(block, split);
      },
      renderFootnotes: split => real.renderFootnotes(split),
      takeCss: () => real.takeCss()
    };
  });

  beforeEach(() => {
    rendered = [];
    session = new PreviewSession(renderer);
  });

  async function update(id: number, source: string): Promise<UpdateResponse> {
    const response = await session.update(id, source);
    if (response.type !== 'update') {
      throw new Error(response.message);
    }
    return response;
  }

  it('renders only new blocks', async () => {
    const first = await update(1, 'One\n\nTwo\n\nOne');
    expect(rendered).toEqual([ 'One', 'Two' ]);
    expect(first.layout.map(block => [ block.fromLine, block.toLine ])).toEqual([ [ 1, 1 ], [ 3, 3 ], [ 5, 5 ] ]);
    expect(first.layout[0].key).toBe(first.layout[2].key);
    expect(first.rendered.map(block => block.html)).toEqual([ '<p>One</p>', '<p>Two</p>' ]);

    rendered = [];
    const second = await update(2, 'One\n\nTwo changed\n\nOne');

    expect(rendered).toEqual([ 'Two changed' ]);
    expect(second.rendered.map(block => block.html)).toEqual([ '<p>Two changed</p>' ]);
    expect(second.id).toBe(2);
  });

  it('renders a block again once it has left the layout', async () => {
    await update(1, 'One\n\nTwo');
    await update(2, 'One');
    rendered = [];

    await update(3, 'One\n\nTwo');

    expect(rendered).toEqual([ 'Two' ]);
  });

  it('renders everything again after reset', async () => {
    await update(1, 'One\n\nTwo');
    session.reset();
    rendered = [];

    const response = await update(2, 'One\n\nTwo');

    expect(rendered).toEqual([ 'One', 'Two' ]);
    expect(response.rendered).toHaveLength(2);
  });

  it('reports the whole file\'s removals', async () => {
    await update(1, 'A <script>x</script>\n\nB <script>y</script>');

    const response = await update(2, 'A <script>x</script>\n\nB <script>y</script> <iframe></iframe>');

    expect(response.rendered).toHaveLength(1);
    expect(response.removals).toEqual([ [ 'tag:script', 2 ], [ 'tag:iframe', 1 ] ]);
  });

  it('sends the footnote list as the last block, once', async () => {
    const first = await update(1, 'Note[^1].\n\n[^1]: Text.');
    const second = await update(2, 'Note[^1].\n\nMore.\n\n[^1]: Text.');

    expect(first.rendered.at(-1)?.html).toContain('data-footnotes');
    expect(second.layout.at(-1)?.key).toBe(first.layout.at(-1)?.key);
    expect(second.rendered.map(block => block.html)).toEqual([ '<p>More.</p>' ]);
  });

  it('sends the CSS of new highlighting classes', async () => {
    const response = await update(1, '```js\nlet a = 1;\n```');

    expect(response.css).toContain('.sk-');
  });

  it('answers with an error when a block fails', async () => {
    const failing = new PreviewSession({
      ...renderer,
      render: () => Promise.reject(new Error('Broken'))
    });

    expect(await failing.update(7, 'Two')).toEqual({ type: 'error', id: 7, message: 'Broken' });
  });
});
