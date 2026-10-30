import { splitBlocks } from '../blocks/split-blocks';
import { purifyHtml } from '../purify/purify-html';
import { type BlockRenderer, createBlockRenderer, type RenderedBlock } from './render-block';

/** Renders a whole file as the preview would, block by block. */
async function renderFile(renderer: BlockRenderer, source: string): Promise<RenderedBlock[]> {
  const split = splitBlocks(source);
  const rendered = [];
  for (const block of split.blocks) {
    rendered.push(await renderer.render(block, split));
  }
  const footnotes = await renderer.renderFootnotes(split);
  return footnotes ? [ ...rendered, footnotes ] : rendered;
}

async function html(renderer: BlockRenderer, source: string): Promise<string> {
  return (await renderFile(renderer, source)).map(block => block.html).join('\n');
}

function dom(markup: string): HTMLElement {
  const container = document.createElement('div');
  container.innerHTML = markup;
  return container;
}

describe('createBlockRenderer', () => {
  let renderer: BlockRenderer;

  beforeAll(async () => {
    renderer = await createBlockRenderer();
  });

  it(
    'AC-EDIT-001.14: renders headings, lists, tables, task lists, strikethrough, autolinks, footnotes and '
      + 'highlighted code, without front matter, and a mermaid block as code',
    async () => {
      const source = [
        '---',
        'title: Hidden',
        '---',
        '',
        '# Title',
        '',
        '- one',
        '- two',
        '',
        '| a | b |',
        '| - | - |',
        '| 1 | 2 |',
        '',
        '- [x] done',
        '- [ ] to do',
        '',
        '~~gone~~ and https://example.com and a note[^1].',
        '',
        '```ts',
        'const answer = 42;',
        '```',
        '',
        '```mermaid',
        'graph TD; A-->B',
        '```',
        '',
        '[^1]: The note.'
      ].join('\n');
      const page = dom(await html(renderer, source));

      expect(page.textContent).not.toContain('Hidden');
      expect(page.querySelector('h1')?.textContent).toBe('Title');
      expect(page.querySelectorAll('ul > li')).toHaveLength(4);
      expect(page.querySelector('table td')?.textContent).toBe('1');
      expect(page.querySelector('input[type=checkbox][checked][disabled]')).not.toBeNull();
      expect(page.querySelector('del')?.textContent).toBe('gone');
      expect(page.querySelector('a[href="https://example.com"]')).not.toBeNull();
      expect(page.querySelector('sup a[data-footnote-ref]')?.textContent).toBe('1');
      expect(page.querySelector('section[data-footnotes] li')?.textContent).toContain('The note.');
      const code = page.querySelector('pre code.language-ts');
      expect(code?.textContent).toBe('const answer = 42;');
      expect(code?.querySelector('span[class^="sk-"]')).not.toBeNull();
      expect(page.querySelector('pre code.language-mermaid')?.textContent).toBe('graph TD; A-->B');
    }
  );

  it('uses classes, never style attributes, for highlighting', async () => {
    const markup = await html(renderer, '```js\nlet a = "x";\n```');

    expect(markup).not.toContain('style');
    expect(markup).not.toContain('shiki');
    expect(markup).toMatch(/^<pre><code class="language-js"><span><span class="sk-\d+">/);
  });

  it('keeps highlighting through the second sanitising step', async () => {
    const markup = await html(renderer, '```js\nlet a = "x";\n```');

    const purified = dom(String(purifyHtml(markup)));

    expect(purified.innerHTML).toBe(markup);
  });

  it('creates one class per colour pair and its CSS once', async () => {
    const own = await createBlockRenderer();

    const first = await html(own, '```js\nlet a = 1;\nlet b = 2;\n```');
    const css = own.takeCss();
    await html(own, '```js\nlet c = 3;\n```');

    const classes = new Set(first.match(/sk-\d+/g));
    const rules = css.trim().split('\n');
    expect(rules).toHaveLength(classes.size);
    expect(rules[0]).toMatch(/^\.sk-1 \{ color: light-dark\(#[\da-f]+, #[\da-f]+\) \}$/);
    expect(own.takeCss()).toBe('');
  });

  it('loads a language on demand', async () => {
    const markup = await html(renderer, '```python\nprint("hi")\n```');

    expect(markup).toContain('class="language-python"');
    expect(markup).toMatch(/class="sk-\d+"/);
  });

  it('renders a code block whose language fails to load as plain code', async () => {
    const broken = await createBlockRenderer({
      languages: { broken: () => Promise.reject(new Error('Chunk failed to load')) }
    });

    const markup = await html(broken, '```broken\n<b>x</b>\n```\n\nAfter');

    expect(markup).toBe('<pre><code class="language-broken">&#x3C;b>x&#x3C;/b>\n</code></pre>\n<p>After</p>');
  });

  it('renders a code block in an unknown language as plain code', async () => {
    expect(await html(renderer, '```nonesuch\ntext\n```')).toBe(
      '<pre><code class="language-nonesuch">text\n</code></pre>'
    );
  });

  it('numbers footnotes across blocks and lists them once', async () => {
    const source = 'First[^b].\n\nSecond[^a] and again[^b].\n\n[^a]: Note A.\n\n[^b]: Note B.';
    const blocks = await renderFile(renderer, source);
    const page = dom(blocks.map(block => block.html).join(''));

    const references = [ ...page.querySelectorAll('a[data-footnote-ref]') ];
    expect(references.map(reference => reference.textContent)).toEqual([ '1', '2', '1' ]);
    expect(references.map(reference => reference.id)).toEqual([
      'user-content-fnref-b',
      'user-content-fnref-a',
      'user-content-fnref-b-2'
    ]);
    expect(references.map(reference => reference.getAttribute('href'))).toEqual([
      '#user-content-fn-b',
      '#user-content-fn-a',
      '#user-content-fn-b'
    ]);
    expect(page.querySelectorAll('section[data-footnotes]')).toHaveLength(1);
    const notes = [ ...page.querySelectorAll('section[data-footnotes] li') ];
    expect(notes.map(note => note.id)).toEqual([ 'user-content-fn-b', 'user-content-fn-a' ]);
    expect(notes[0].textContent).toContain('Note B.');
    const backReferences = [ ...notes[0].querySelectorAll('a[data-footnote-backref]') ];
    expect(backReferences.map(link => link.getAttribute('href'))).toEqual([
      '#user-content-fnref-b',
      '#user-content-fnref-b-2'
    ]);
    expect(blocks.at(-1)?.html.startsWith('<section')).toBe(true);
  });

  it('renders no footnote list without footnotes', async () => {
    expect(await renderer.renderFootnotes(splitBlocks('No notes, [^x].'))).toBeNull();
  });

  it('resolves a link reference defined at the end of the file', async () => {
    expect(await html(renderer, 'See [the guide].\n\nMore.\n\n[the guide]: ./guide.md')).toBe(
      '<p>See <a href="./guide.md">the guide</a>.</p>\n<p>More.</p>\n'
    );
  });

  it('prefixes heading IDs', async () => {
    const page = dom(await html(renderer, '# Hello, World!\n\n## Hello, World!\n\n<h3 id="own">Own</h3>'));

    expect([ ...page.querySelectorAll('h1, h2, h3') ].map(heading => heading.id)).toEqual([
      'user-content-hello-world',
      'user-content-hello-world',
      'user-content-own'
    ]);
  });

  it('reports what was removed from a block', async () => {
    const [ block ] = await renderFile(renderer, 'Text <script>x</script> <b onclick="y">b</b>');

    expect(block.removals).toEqual([ [ 'tag:script', 1 ], [ 'attribute:onclick', 1 ] ]);
  });

  it('never takes highlighting classes from the file', async () => {
    const markup = await html(renderer, '<span class="sk-1">x</span> <pre><code class="sk-2">y</code></pre>');

    expect(markup).not.toContain('sk-');
  });

  it('AC-EDIT-001.17: shows mdx import lines as text', async () => {
    const markup = await html(renderer, 'import { Chart } from \'./chart\';\n\n<Chart>Data</Chart>');

    expect(markup).toBe('<p>import { Chart } from \'./chart\';</p>\n<p>Data</p>');
  });
});
