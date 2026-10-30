import { collectRemovals, mergeRemovals, type RemovalReport } from './collect-removals';
import { markdownToHast, renderSafeHtml } from './render-safe-html';

function removals(markdown: string): Record<string, number> {
  return Object.fromEntries(collectRemovals(markdownToHast(markdown)));
}

describe('collectRemovals', () => {
  it('AC-EDIT-002.13: counts two iframes and five style attributes', () => {
    const markdown = [
      '<iframe src="https://example.com/a"></iframe>',
      '<iframe src="https://example.com/b"></iframe>',
      '',
      ...Array.from({ length: 5 }, (_, index) => `<p style="color: red">${index}</p>`)
    ].join('\n');

    expect(removals(markdown)).toEqual({ 'tag:iframe': 2, 'attribute:style': 5 });
  });

  it('counts a content-removed tag once', () => {
    expect(removals('<script><b onclick="x">a</b><script></script></script>')).toEqual({ 'tag:script': 1 });
    expect(removals('<svg><g onload="x"><script>a</script></g></svg>')).toEqual({ 'tag:svg': 1 });
    expect(removals('<center><b class="x">a</b></center>')).toEqual({ 'tag:center': 1, 'attribute:class': 1 });
  });

  it('counts addresses by scheme', () => {
    expect(
      removals(
        '<a href="javascript:a">a</a> <a href="JaVa&#x09;Script:b">b</a> [c](javascript:c) <img src="data:image/png,x">'
      )
    ).toEqual({ 'address:javascript': 3, 'address:data': 1 });
  });

  it('counts other removals the way the sanitiser makes them', () => {
    expect(removals('<input type="text"> <source srcset="a.png"> <img width="1em" align="middle" onerror="x">'))
      .toEqual(
        { 'tag:input': 1, 'tag:source': 1, 'attribute:width': 1, 'attribute:align': 1, 'attribute:onerror': 1 }
      );
    expect(removals('<code class="language-ts evil">a</code> <code class="language-js">b</code>')).toEqual({
      'attribute:class': 1
    });
  });

  it('counts values that DOMPurify would remove as markup', () => {
    expect(removals('<abbr title="a-->b">x</abbr> <span lang="</style>">y</span>')).toEqual({
      'attribute:title': 1,
      'attribute:lang': 1
    });
    expect(renderSafeHtml('<abbr title="a-->b">x</abbr>').html).toBe('<p><abbr>x</abbr></p>');
  });

  it('counts nothing for code blocks in any language', () => {
    expect(removals('```ts:app.ts\nx\n```\n\n```日本語\nx\n```\n\n```c++\nx\n```')).toEqual({});
  });

  it('does not count comments', () => {
    expect(removals('<!-- a comment -->\n\nText <!-- another -->')).toEqual({});
  });

  it('does not count the pipeline\'s own markup', () => {
    expect(removals('- [x] task\n\nNote[^1]\n\n[^1]: Text.')).toEqual({});
    expect(removals('<li class="task-list-item">a</li> <a data-footnote-ref href="#x">b</a>')).toEqual({
      'attribute:class': 1,
      'attribute:data-footnote-ref': 1
    });
  });

  it('never includes values or text', () => {
    const report = collectRemovals(
      markdownToHast(
        '<b style="SECRET">a</b> <a href="javascript:SECRET">b</a> <script>SECRET</script> <i title="t" lang="x">c</i>'
      )
    );

    expect(JSON.stringify([ ...report ])).not.toMatch(/secret/i);
    expect([ ...report.keys() ]).toEqual([ 'attribute:style', 'address:javascript', 'tag:script' ]);
  });

  it('is part of renderSafeHtml', () => {
    expect(renderSafeHtml('<center>a</center>').removals).toEqual(new Map([ [ 'tag:center', 1 ] ]));
  });
});

describe('mergeRemovals', () => {
  it('adds up the counts', () => {
    const a: RemovalReport = new Map([ [ 'tag:iframe', 1 ], [ 'attribute:style', 2 ] ]);
    const b: RemovalReport = new Map([ [ 'attribute:style', 3 ] ]);

    expect(mergeRemovals([ a, b, new Map() ])).toEqual(new Map([ [ 'tag:iframe', 1 ], [ 'attribute:style', 5 ] ]));
  });
});
