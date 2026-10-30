import { renderSafeHtml } from './render-safe-html';

function render(markdown: string): string {
  return renderSafeHtml(markdown).html;
}

/** The HTML parsed into a document fragment, to query it. */
function dom(markdown: string): HTMLElement {
  const container = document.createElement('div');
  container.innerHTML = render(markdown);
  return container;
}

describe('renderSafeHtml', () => {
  it('AC-EDIT-002.1: keeps a centred image with its size and alt text', () => {
    expect(render('<p align="center"><img src="logo.png" width="120" alt="Logo"></p>')).toBe(
      '<p align="center"><img src="logo.png" width="120" alt="Logo"></p>'
    );
  });

  it('AC-EDIT-002.2: keeps details and summary, with open', () => {
    expect(render('<details><summary>More</summary>Hidden text</details>')).toBe(
      '<details><summary>More</summary>Hidden text</details>'
    );
    expect(render('<details open><summary>More</summary>Hidden text</details>')).toBe(
      '<details open><summary>More</summary>Hidden text</details>'
    );
  });

  it('AC-EDIT-002.3: keeps kbd, sub, sup, mark and abbr with its title', () => {
    const html = '<kbd>Ctrl</kbd> <sub>2</sub> <sup>3</sup> <mark>m</mark> <abbr title="HyperText: Markup">HTML</abbr>';

    expect(render(html)).toBe(`<p>${html}</p>`);
  });

  it('AC-EDIT-002.4: keeps a raw table with colspan, rowspan and align', () => {
    expect(render('<table><tr><th colspan="2" align="right">a</th></tr><tr><td rowspan="2">b</td></tr></table>')).toBe(
      '<table><tbody><tr><th colspan="2" align="right">a</th></tr><tr><td rowspan="2">b</td></tr></tbody></table>'
    );
  });

  it('AC-EDIT-002.5: keeps picture, source with media and srcset, and img', () => {
    expect(
      render('<picture><source media="(prefers-color-scheme: dark)" srcset="dark.png"> <img src="light.png"></picture>')
    ).toBe(
      '<p><picture><source media="(prefers-color-scheme: dark)" srcset="dark.png"> <img src="light.png"></picture></p>'
    );
  });

  it('AC-EDIT-002.6: drops tags that are not allowed and keeps their text', () => {
    expect(render('<center>Hello</center>')).toBe('Hello');
    expect(render('<my-widget>Hello</my-widget>')).toBe('<p>Hello</p>');
  });

  it('AC-EDIT-002.7: removes script, style and iframe with their content', () => {
    expect(render('<script>alert(1)</script>')).toBe('');
    expect(render('<style>body{display:none}</style>')).toBe('');
    expect(render('<iframe src="https://example.com">text</iframe>')).toBe('');
  });

  it('AC-EDIT-002.8: removes event handlers and forbidden link addresses', () => {
    expect(render('<img src=x onerror="alert(1)">')).toBe('<img src="x">');
    expect(render('<a href="javascript:alert(1)">x</a>')).toBe('<p><a>x</a></p>');
    expect(render('<a href="JaVaScRiPt&colon;alert(1)">x</a>')).toBe('<p><a>x</a></p>');
    expect(render('[x](javascript:alert(1))')).toBe('<p><a>x</a></p>');
  });

  it('AC-EDIT-002.9: removes style and class', () => {
    expect(render('<div style="position:fixed;inset:0">a</div>')).toBe('<div>a</div>');
    expect(render('<div class="app-header">a</div>')).toBe('<div>a</div>');
  });

  it('AC-EDIT-002.10: prefixes id and name, and keeps links to them', () => {
    expect(render('<a name="install"></a>\n\n[Install](#install)')).toBe(
      '<p><a name="user-content-install"></a></p>\n<p><a href="#install">Install</a></p>'
    );
    expect(render('<div id="app">a</div>')).toBe('<div id="user-content-app">a</div>');
  });

  it('AC-EDIT-002.11: keeps a checkbox, disabled, and removes any other input', () => {
    expect(render('<input type="checkbox" checked>')).toBe('<input type="checkbox" checked disabled>');
    expect(render('A <input type="CHECKBOX">')).toBe('<p>A <input type="checkbox" disabled></p>');
    expect(render('a <input type="text"> <input> b')).toBe('<p>a   b</p>');
  });

  it('AC-EDIT-002.12: keeps only a language- class on code', () => {
    expect(render('```ts\nlet a;\n```')).toBe('<pre><code class="language-ts">let a;\n</code></pre>');
    expect(render('<code class="evil">x</code>')).toBe('<p><code>x</code></p>');
    expect(render('<code class="evil language-js">x</code>')).toBe('<p><code class="language-js">x</code></p>');
    expect(render('```ts:app.ts\nx\n```')).toBe('<pre><code class="language-ts:app.ts">x\n</code></pre>');
  });

  it('AC-EDIT-002.17: reads protocol-relative addresses as https:', () => {
    expect(render('<img src="//cdn.example.com/a.png">')).toBe('<img src="https://cdn.example.com/a.png">');
    expect(render('<a href="//example.com">e</a>')).toBe('<p><a href="https://example.com">e</a></p>');
  });

  it('keeps pipeline markup only outside raw HTML', () => {
    const markdown = [
      '- [x] done',
      '',
      'Text[^1]',
      '',
      '<a data-footnote-ref href="#x" id="fnref-x" aria-describedby="footnote-label">raw</a>',
      '<ul class="contains-task-list"><li class="task-list-item" id="fn-2">',
      '<input type="checkbox" class="task-list-item-checkbox"></li></ul>',
      '<section data-footnotes class="footnotes"><h2 class="sr-only">Raw</h2></section>',
      '',
      '[^1]: Note.'
    ].join('\n');
    const container = dom(markdown);

    // From Markdown: kept.
    const [ list, rawList ] = Array.from(container.querySelectorAll('ul'));
    expect(list?.className).toBe('contains-task-list');
    expect(list?.querySelector('li')?.className).toBe('task-list-item');
    const reference = container.querySelector('sup > a');
    expect(reference?.outerHTML).toBe(
      '<a href="#user-content-fn-1" id="user-content-fnref-1" data-footnote-ref="" aria-describedby="user-content-footnote-label">1</a>'
    );
    const footnotes = container.querySelectorAll('section');
    expect(footnotes[1]?.outerHTML).toContain('<section data-footnotes="" class="footnotes">');
    expect(footnotes[1]?.querySelector('h2')?.outerHTML).toBe(
      '<h2 id="user-content-footnote-label" class="sr-only">Footnotes</h2>'
    );
    expect(footnotes[1]?.querySelector('li')?.id).toBe('user-content-fn-1');
    expect(footnotes[1]?.querySelector('[data-footnote-backref]')?.className).toBe('data-footnote-backref');

    // From raw HTML: only what the whitelist allows any file.
    expect(container.querySelector('a[href="#x"]')?.outerHTML).toBe('<a href="#x" id="user-content-fnref-x">raw</a>');
    expect(rawList?.outerHTML).toBe('<ul><li id="user-content-fn-2">\n<input type="checkbox" disabled=""></li></ul>');
    expect(footnotes[0]?.outerHTML).toBe('<section><h2>Raw</h2></section>');
  });

  it('keeps no pipeline markup on elements the HTML parser copies from raw HTML', () => {
    const container = dom('<p><a href="#q" data-footnote-ref>x<p>y\n\nText[^1]\n\n[^1]: Note.');

    expect(container.querySelectorAll('[data-footnote-ref]')).toHaveLength(1);
    expect(container.querySelector('[data-footnote-ref]')?.getAttribute('href')).toBe('#user-content-fn-1');
  });

  it('removes obfuscated addresses', () => {
    for (
      const markdown of [
        '<a href="jav&#x09;ascript:alert(1)">x</a>',
        '<a href="jav\tascript:alert(1)">x</a>',
        '<a href="JaVaScRiPt&colon;alert(1)">x</a>',
        '<a href="&#106;avascript:alert(1)">x</a>',
        '<a href=" &#x20;javascript:alert(1)">x</a>',
        '[x](JAVASCRIPT:alert(1))',
        '<a href="data:text/html;base64,PHNjcmlwdD4=">x</a>'
      ]
    ) {
      expect(render(markdown), markdown).toBe('<p><a>x</a></p>');
    }
    expect(render('<img src="javascript:alert(1)" alt="a">')).toBe('<img alt="a">');
    expect(render('<picture><source srcset="a.png 1x, javascript:x 2x"></picture>')).toBe(
      '<p><picture><source></picture></p>'
    );
    expect(render('<q cite="vbscript:x">q</q>')).toBe('<p><q>q</q></p>');
  });

  it('parses split and malformed HTML as a browser would', () => {
    expect(render('<details>\n<summary>More</summary>\n\nSome **bold** text\n\n</details>\n\nAfter')).toBe(
      '<details>\n<summary>More</summary>\n<p>Some <strong>bold</strong> text</p>\n</details>\n<p>After</p>'
    );
    expect(render('<div>\n\n*open*\n\nRest of the file')).toBe(
      '<div>\n<p><em>open</em></p>\n<p>Rest of the file</p></div>'
    );
    expect(render('</div></span>\n\nText')).toBe('\n<p>Text</p>');
    expect(render('<b class="x\n\nRest')).toContain('Rest');
    expect(render('Before <!-- never closed\n\nAfter')).toBe('<p>Before &#x3C;!-- never closed</p>\n<p>After</p>');
  });

  it('renders tables, task lists, strikethrough, autolinks and footnotes', () => {
    const html = render(
      '| a | b |\n| - | :-: |\n| 1 | 2 |\n\n- [ ] task\n\n~~gone~~ www.example.com\n\nNote[^n]\n\n[^n]: Text.'
    );

    expect(html).toContain('<table>');
    expect(html).toContain('<td align="center">2</td>');
    expect(html).toContain('<li class="task-list-item"><input type="checkbox" disabled> task</li>');
    expect(html).toContain('<del>gone</del>');
    expect(html).toContain('<a href="http://www.example.com">www.example.com</a>');
    expect(html).toContain('<section data-footnotes="" class="footnotes">');
  });

  it('drops front matter', () => {
    expect(render('---\ntitle: <script>x</script>\n---\n\n# Title')).toBe('<h1>Title</h1>');
  });

  it('shows mdx import lines as text and drops JSX tags', () => {
    expect(render('import Chart from "./chart"\n\n<Chart data={x}>Caption</Chart>')).toBe(
      '<p>import Chart from "./chart"</p>\n<p>Caption</p>'
    );
  });

  it('renders task list checkboxes disabled', () => {
    expect(render('- [x] done\n- [ ] todo')).toBe(
      '<ul class="contains-task-list">\n'
        + '<li class="task-list-item"><input type="checkbox" checked disabled> done</li>\n'
        + '<li class="task-list-item"><input type="checkbox" disabled> todo</li>\n'
        + '</ul>'
    );
  });

  it('shows blog-engine markup as text', () => {
    expect(render('{% blockquote %}\nQuote\n{% endblockquote %}')).toBe(
      '<p>{% blockquote %}\nQuote\n{% endblockquote %}</p>'
    );
  });
});
