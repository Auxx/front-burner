import { splitBlocks } from './split-blocks';

const texts = (source: string) => splitBlocks(source).blocks.map(block => block.text);

describe('splitBlocks', () => {
  it('ends a block at a blank line', () => {
    const { blocks } = splitBlocks('First\nparagraph\n\n\nSecond\n');

    expect(blocks.map(({ text, fromLine, toLine }) => ({ text, fromLine, toLine }))).toEqual([
      { text: 'First\nparagraph', fromLine: 1, toLine: 2 },
      { text: 'Second', fromLine: 5, toLine: 5 }
    ]);
  });

  it('keeps indented lines after a blank line in the block', () => {
    expect(texts('Text\n\n    code\n\nNext')).toEqual([ 'Text\n\n    code', 'Next' ]);
  });

  it('keeps a list item\'s continuation', () => {
    expect(texts('- one\n\n  more of one\n\n- two\n\n1. three\n\nAfter')).toEqual([
      '- one\n\n  more of one\n\n- two\n\n1. three',
      'After'
    ]);
  });

  it('starts a block at an ATX heading', () => {
    expect(texts('Text\n# Heading\nMore\n## Sub')).toEqual([ 'Text', '# Heading\nMore', '## Sub' ]);
    expect(texts('Text\n#hashtag\n    # indented')).toEqual([ 'Text\n#hashtag\n    # indented' ]);
  });

  it('never splits a fenced code block', () => {
    const fenced = '```ts\nconst a = 1;\n\nunindented();\n# not a heading\n````';
    expect(texts(`${fenced}\n\nAfter`)).toEqual([ fenced, 'After' ]);
    const tildes = '~~~\n```\n\nstill code\n~~~';
    expect(texts(`${tildes}\n\nAfter`)).toEqual([ tildes, 'After' ]);
    const inList = '- item\n\n  ```\n  # code\n\n  ```';
    expect(texts(`${inList}\n\nAfter`)).toEqual([ inList, 'After' ]);
  });

  it('runs an unclosed fence to the end of the file', () => {
    expect(texts('```\ncode\n\nmore')).toEqual([ '```\ncode\n\nmore' ]);
  });

  it('never splits a multi-line HTML block', () => {
    const comment = '<!--\n\nhidden\n\n# hidden\n-->';
    expect(texts(`${comment}\n\nAfter`)).toEqual([ comment, 'After' ]);
    const pre = '<pre>\n\nraw\n</pre>';
    expect(texts(`${pre}\n\nAfter`)).toEqual([ pre, 'After' ]);
    const div = '<div>\n# not a heading\n</div>';
    expect(texts(`${div}\n\n# Heading`)).toEqual([ div, '# Heading' ]);
    expect(texts('<!-- one line -->\n\nAfter')).toEqual([ '<!-- one line -->', 'After' ]);
  });

  it('skips front matter', () => {
    const { blocks } = splitBlocks('---\ntitle: x\n\nlist:\n---\n\n# Title\n');

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ text: '# Title', fromLine: 7, toLine: 7 });
  });

  it('reads an unclosed front matter fence as Markdown', () => {
    expect(texts('---\ntext')).toEqual([ '---\ntext' ]);
  });

  it('gives equal text equal keys', () => {
    const { blocks } = splitBlocks('Same\n\nOther\n\nSame');

    expect(blocks[0].key).toBe(blocks[2].key);
    expect(blocks[0].key).not.toBe(blocks[1].key);
    expect(splitBlocks('Other\n\nSame').blocks[1].key).toBe(blocks[0].key);
  });

  it('collects every link reference definition', () => {
    const { definitions } = splitBlocks('[a]: /a\n\nText [b]\n\n[B]: /b\n  "Title"\n[c]:\n  /c');

    expect(definitions).toBe('[a]: /a\n[B]: /b\n  "Title"\n[c]:\n  /c');
  });

  it('re-keys only the blocks that use a changed definition', () => {
    const before = splitBlocks('Uses [link].\n\nUses [Other][].\n\nUses none.\n\n[link]: /one\n[other]: /x');
    const after = splitBlocks('Uses [link].\n\nUses [Other][].\n\nUses none.\n\n[link]: /two\n[other]: /x');

    expect(after.definitions).toBe('[link]: /two\n[other]: /x');
    expect(after.blocks[0].key).not.toBe(before.blocks[0].key);
    expect(after.blocks[1].key).toBe(before.blocks[1].key);
    expect(after.blocks[2].key).toBe(before.blocks[2].key);
  });

  it('numbers footnotes in file order', () => {
    const { blocks, footnotes } = splitBlocks(
      'Late[^b] and `[^a]`.\n\nEarly[^a] and [^B] again, [^none].\n\n[^a]: Note A\n    more\n[^b]: Note B'
    );

    expect([ ...footnotes.numbers ]).toEqual([ [ 'b', 1 ], [ 'a', 2 ] ]);
    expect([ ...footnotes.counts ]).toEqual([ [ 'b', 2 ], [ 'a', 1 ] ]);
    expect([ ...footnotes.definitions ]).toEqual([ [ 'a', '[^a]: Note A\n    more' ], [ 'b', '[^b]: Note B' ] ]);
    expect(blocks[0].footnotes).toEqual([ { label: 'b', number: 1, first: 1 } ]);
    expect(blocks[1].footnotes).toEqual([ { label: 'a', number: 2, first: 1 }, { label: 'b', number: 1, first: 2 } ]);
  });

  it('re-keys a block whose footnote is renumbered', () => {
    const before = splitBlocks('One[^a]\n\nTwo[^b]\n\n[^a]: A\n[^b]: B');
    const after = splitBlocks('One[^b]\n\nTwo[^b]\n\n[^a]: A\n[^b]: B');

    expect(after.blocks[1].key).not.toBe(before.blocks[1].key);
  });

  it('splits a 1 MB file within 50 ms', () => {
    const paragraph = 'A paragraph of ordinary length, with **emphasis**, `code`, a [link] and a footnote[^1]. '.repeat(
      3
    );
    const chunk = `## Heading\n\n${paragraph}\n\n- item\n- item with more text\n\n\`\`\`ts\nconst a = 1;\n\n`
      + `console.log(a);\n\`\`\`\n\n> A quote\n> on two lines\n\n${paragraph}\n\n`;
    const fileOf = (size: number) => chunk.repeat(Math.ceil(size / chunk.length)) + '[link]: /x\n\n[^1]: Note\n';
    const source = fileOf(1_000_000);
    const eighth = fileOf(125_000);
    // The best of a few runs, once the code is warm, taken in turns so that a
    // busy machine slows both sizes alike.
    let elapsed = Infinity;
    let elapsedEighth = Infinity;
    for (let run = 0; run < 8; run++) {
      elapsedEighth = Math.min(elapsedEighth, timed(() => splitBlocks(eighth)));
      elapsed = Math.min(elapsed, timed(() => splitBlocks(source)));
    }

    expect(splitBlocks(source).blocks.length).toBeGreaterThan(5_000);
    // About 20 ms on a desktop. On a busy machine the test still holds while
    // the time grows about linearly, 8 times for 8 times the text; a
    // quadratic scanner would take 64 times as long.
    expect(elapsed).toBeLessThan(Math.max(50, 24 * elapsedEighth));
  });
});

function timed(run: () => void): number {
  const start = performance.now();
  run();
  return performance.now() - start;
}
