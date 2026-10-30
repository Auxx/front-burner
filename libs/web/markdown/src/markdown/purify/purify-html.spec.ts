import { renderSafeHtml } from '../pipeline/render-safe-html';
import { purifyHtml } from './purify-html';

/** HTML as the browser serialises it, with image addresses moved as DOMPurify's step moves them (IM-24). */
function serialised(html: string): string {
  const template = document.createElement('template');
  template.innerHTML = html;
  for (const element of Array.from(template.content.querySelectorAll('img[src], source[srcset]'))) {
    const [ from, to ] = element.localName === 'img' ? [ 'src', 'data-md-src' ] : [ 'srcset', 'data-md-srcset' ];
    element.setAttribute(to, element.getAttribute(from) ?? '');
    element.removeAttribute(from);
  }
  return template.innerHTML;
}

const KEPT = [
  '<p align="center"><img src="logo.png" width="120" alt="Logo"></p>',
  '<details open><summary>More</summary>Hidden text</details>',
  '<kbd>Ctrl</kbd> <sub>2</sub> <sup>3</sup> <mark>m</mark> <abbr title="HyperText: Markup">HTML</abbr>',
  '<table><tr><th colspan="2" align="right" valign="top" width="50%">a</th></tr><tr><td rowspan="2">b</td></tr></table>',
  '<picture><source media="(prefers-color-scheme: dark)" srcset="dark.png 1x, //cdn.example.com/b.png 2x"> <img src="light.png"></picture>',
  '<center>Hello</center> <my-widget>Hello</my-widget>',
  '<a name="install"></a>\n\n[Install](#install) <div id="app">a</div>',
  '<input type="checkbox" checked> <input type="CHECKBOX">',
  '```ts\nlet a;\n```\n\n<code class="evil language-js">x</code>',
  '<img src="//cdn.example.com/a.png"> <a href="//example.com">e</a> [m](mailto:me@example.com)',
  '<ol start="3" reversed type="a"><li value="4">x</li></ol> <q cite="https://example.com">q</q> <del datetime="2026-10-29T10:00">d</del>',
  '<table><tr><td headers="row:1 row:2">a</td></tr></table> <time datetime="T:10">t</time> <abbr title="Note: x">n</abbr>',
  '```ts:app.ts\nlet a;\n```\n\n```日本語\nx\n```',
  '<bdo dir="rtl" lang="ar">x</bdo> <ruby>漢<rp>(</rp><rt>kan</rt><rp>)</rp></ruby>',
  '| a | b |\n| - | :-: |\n| 1 | 2 |\n\n- [x] task\n\n~~gone~~ www.example.com\n\nNote[^n]\n\n[^n]: Text.'
];

describe('purifyHtml', () => {
  it('keeps what the first step kept', () => {
    for (const markdown of KEPT) {
      const { html } = renderSafeHtml(markdown);

      expect(String(purifyHtml(html)), markdown).toBe(serialised(html));
    }
  });

  it('keeps a single user-content- prefix', () => {
    expect(String(purifyHtml('<h2 id="user-content-intro">a</h2><a name="user-content-x"></a>'))).toBe(
      '<h2 id="user-content-intro">a</h2><a name="user-content-x"></a>'
    );
    expect(String(purifyHtml('<div id="app">a</div><a name="install"></a>'))).toBe(
      '<div id="user-content-app">a</div><a name="user-content-install"></a>'
    );
    const { html } = renderSafeHtml('Note[^1]\n\n[^1]: Text.');
    expect(String(purifyHtml(html))).not.toContain('user-content-user-content-');
  });

  it('applies the whitelist\'s rules per tag', () => {
    expect(String(purifyHtml('<p width="10" href="https://example.com">a</p>'))).toBe('<p>a</p>');
    expect(String(purifyHtml('<img src="a.png" width="1em" align="middle">'))).toBe('<img data-md-src="a.png">');
    expect(String(purifyHtml('<img src="mailto:me@example.com"><a href="mailto:me@example.com">m</a>'))).toBe(
      '<img><a href="mailto:me@example.com">m</a>'
    );
    expect(String(purifyHtml('<a href="JaVa&#x09;Script:x">x</a><a href="HTTPS://example.com">y</a>'))).toBe(
      '<a>x</a><a href="https://example.com">y</a>'
    );
    expect(String(purifyHtml('<source srcset="a.png"><input type="text"><input type="checkbox" checked>'))).toBe(
      '<input type="checkbox" checked="" disabled="">'
    );
    expect(String(purifyHtml('<div data-x="1" aria-hidden="true" data-footnote-ref="">a</div>'))).toBe('<div>a</div>');
  });

  it('leaves no src or srcset in purified HTML', () => {
    const { html } = renderSafeHtml(
      '![a](a.png) <img src="https://example.com/b.png" width="20">\n\n'
        + '<picture><source media="(prefers-color-scheme: dark)" srcset="dark.png 1x, //cdn.example.com/d.png 2x">'
        + '<img src="light.png"></picture>'
    );
    const template = document.createElement('template');
    template.innerHTML = String(purifyHtml(html));

    expect(template.content.querySelectorAll('[src], [srcset]')).toHaveLength(0);
    expect(template.content.querySelectorAll('img')).toHaveLength(3);
  });

  it('keeps the address in the pipeline attribute', () => {
    expect(String(purifyHtml('<img src=" a.png " alt="A" width="20">'))).toBe(
      '<img alt="A" width="20" data-md-src="a.png">'
    );
    expect(String(purifyHtml('<picture><source srcset="a.png 1x, //cdn.example.com/b.png 2x"></picture>'))).toBe(
      '<picture><source data-md-srcset="a.png 1x, https://cdn.example.com/b.png 2x"></picture>'
    );
    expect(String(purifyHtml('<img src="javascript:alert(1)">'))).toBe('<img>');
  });

  it('drops a data-md-src written in the file', () => {
    const { html } = renderSafeHtml('<img data-md-src="https://example.com/x.png"><source data-md-srcset="x.png">');

    expect(html).not.toContain('data-md-');
    expect(String(purifyHtml('<img data-md-src="https://example.com/x.png" alt="x">'))).toBe('<img alt="x">');
    expect(String(purifyHtml('<picture><source data-md-srcset="x.png"></picture>'))).toBe(
      '<picture><source></picture>'
    );
  });

  it('keeps only the classes the pipeline and highlighting add', () => {
    expect(String(purifyHtml('<span class="sk-1 evil">a</span><div class="sk-1">b</div>'))).toBe(
      '<span class="sk-1">a</span><div>b</div>'
    );
    expect(String(purifyHtml('<li class="task-list-item app-header">a</li><code class="language-ts x">b</code>'))).toBe(
      '<li class="task-list-item">a</li><code class="language-ts">b</code>'
    );
  });
});
