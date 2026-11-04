import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { definedTokens, readSources, unknownTokens } from './unknown-tokens.mjs';
import { WORKSPACE_ROOT, workspacePath } from './workspace.mjs';

const source = (path, text) => ({ path, text });

describe('unknown tokens', () => {
  it('reports a reference to a token nobody defines, with its line', () => {
    const defined = definedTokens([ source('tokens.scss', ':root { --ui-text-muted: grey; }') ]);
    const found = unknownTokens(
      [ source('a.scss', ':host {\n  color: var(--ui-color-text-muted);\n  background: var(--ui-text-muted);\n}') ],
      defined
    );

    expect(found).toEqual([ { file: 'a.scss', line: 2, name: '--ui-color-text-muted' } ]);
  });

  it('counts declarations, token map keys, style bindings and setProperty as definitions', () => {
    const defined = definedTokens([
      source(
        '_color.scss',
        '$tokens: (\n  // Text\n  text-muted: (functions.ref(neutral-45), functions.ref(neutral-75)),\n);'
      ),
      source('_density.scss', '$tokens: (\n  control-height: (1.75rem, 2.75rem),\n);'),
      source('theme.ts', `const theme = { '--ui-checkbox-mark': 'red' };`),
      source('pane.html', '<div [style.--ui-pane-size]="size"></div>'),
      source('copy.ts', `element.style.setProperty('--ui-overlay-top', '0')`)
    ]);

    expect([ ...defined ].sort()).toEqual([
      '--ui-checkbox-mark',
      '--ui-control-height',
      '--ui-overlay-top',
      '--ui-pane-size',
      '--ui-text-muted'
    ]);
  });

  it('does not count definitions in specs, stories or comments', () => {
    const defined = definedTokens([
      source('a.component.spec.ts', `const style = '--ui-in-spec: red';`),
      source('a.component.stories.ts', `styles: [ 'b { --ui-in-story: red; }' ]`),
      source('a.scss', '// --ui-in-line-comment: red;\n/* --ui-in-block-comment: red; */\na { --ui-real: red; }'),
      source('b.ts', `// '--ui-in-ts-comment': 'red'`)
    ]);

    expect([ ...defined ]).toEqual([ '--ui-real' ]);
  });

  it('leaves out references with a fallback and names built by interpolation', () => {
    const found = unknownTokens(
      [ source('a.scss', 'a { b: var(--ui-banner-background, transparent); c: var(--ui-#{$status}-border); }') ],
      new Set()
    );

    expect(found).toEqual([]);
  });

  it('throws on a token map it cannot read', () => {
    expect(() => definedTokens([ source('_color.scss', '$tokens: (\n  text-muted: (a, b),\n') ])).toThrow(
      /_color.scss: the \$tokens map is not closed/
    );
  });

  describe('reading the workspace', () => {
    let fixture;

    beforeAll(() => {
      mkdirSync(join(WORKSPACE_ROOT, 'tmp'), { recursive: true });
      fixture = mkdtempSync(join(WORKSPACE_ROOT, 'tmp', 'ai-tools-unknown-tokens-'));
      mkdirSync(join(fixture, 'src', 'node_modules'), { recursive: true });
      writeFileSync(join(fixture, 'src', 'a.scss'), 'a {}');
      writeFileSync(join(fixture, 'src', 'b.ts'), 'export {}');
      writeFileSync(join(fixture, 'src', 'c.md'), '# not read');
      writeFileSync(join(fixture, 'src', 'node_modules', 'd.scss'), 'a {}');
      symlinkSync(join(fixture, 'src'), join(fixture, 'link'));
    });

    afterAll(() => rmSync(fixture, { recursive: true, force: true }));

    it('reads SCSS, TypeScript and HTML files, without node_modules or symbolic links', () => {
      const relative = workspacePath(fixture);
      const paths = readSources([ relative ]).map(found => found.path).sort();

      expect(paths).toEqual([ `${relative}/src/a.scss`, `${relative}/src/b.ts` ]);
    });

    it('says so when given a file instead of a folder', () => {
      const relative = fixture.slice(WORKSPACE_ROOT.length + 1);

      expect(() => readSources([ `${relative}/src/a.scss` ])).toThrow(/is not a folder/);
    });

    it('refuses a folder outside the workspace', () => {
      expect(() => readSources([ '../outside' ])).toThrow();
    });

    it('finds no unknown token in libs', () => {
      const sources = readSources([ 'libs' ]);

      expect(unknownTokens(sources, definedTokens(sources))).toEqual([]);
    });
  });
});
