import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SYNTAX_THEME, SYNTAX_TOKENS } from './shiki-classes';

describe('shiki-classes', () => {
  it('colours with syntax tokens only (A-10.14)', () => {
    const colours = new Set(SYNTAX_THEME.settings?.map(setting => setting.settings.foreground));

    expect([ ...colours ]).toEqual(SYNTAX_TOKENS.map(token => `var(--ui-syntax-${token})`));
  });

  it('has a rule in the preview\'s stylesheet for every class', () => {
    const scss = readFileSync(
      join(import.meta.dirname, '../components/markdown-preview/markdown-preview.component.scss'),
      'utf8'
    );
    const listed = /@each \$token in \(([^)]*)\)/.exec(scss)?.[1].split(',').map(token => token.trim());

    expect(listed?.sort()).toEqual([ ...SYNTAX_TOKENS ].sort());
  });
});
