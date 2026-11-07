import nx from '@nx/eslint-plugin';
import { ESLint } from 'eslint';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import angularTemplates from './angular-templates.config.mjs';

const lines = (...parts) => parts.join('\n');

const eslint = new ESLint({
  cwd: import.meta.dirname,
  overrideConfigFile: true,
  overrideConfig: [
    ...nx.configs['flat/angular'],
    ...nx.configs['flat/angular-template'],
    ...angularTemplates
  ]
});

/** The `[ ruleId, severity ]` pairs that linting `code` as `filePath` reports, sorted and without repeats. */
async function reported(code, filePath) {
  const [ result ] = await eslint.lintText(code, { filePath });
  const fatal = result.messages.filter(message => message.fatal);
  expect(fatal).toEqual([]);
  const pairs = result.messages.map(message => `${message.ruleId} ${message.severity}`);
  return [ ...new Set(pairs) ].sort();
}

/** A component file whose inline template is `template`, written on the backtick's line. */
const component = template =>
  lines(
    'import { Component } from \'@angular/core\';',
    '',
    '@Component({',
    '  selector: \'app-x\',',
    `  template: \`${template}\``,
    '})',
    'export class XComponent {}',
    ''
  );

const specHostTemplate = lines(
  '<a href="x" class="y">{{ fmt(a) }}</a>',
  '<div *ngIf="a">{{ $any(a) }}</div>',
  '<img src="a">'
);

describe('angular-templates config', () => {
  it('turns the rules on, as errors, for template files', async () => {
    const code = lines(
      '<p>{{ fmt(a) }}</p>',
      '<p>{{ $any(a) }}</p>',
      '<div *ngIf="a"></div>',
      '<img src="a">'
    );

    expect(await reported(code, 'app/x.component.html')).toEqual([
      '@angular-eslint/template/alt-text 2',
      '@angular-eslint/template/no-any 2',
      '@angular-eslint/template/prefer-control-flow 2',
      'front-burner/no-template-calls 2'
    ]);
  });

  it('covers inline templates', async () => {
    expect(await reported(component('<p>{{ fmt(a) }}</p>'), 'app/x.component.ts')).toEqual([
      'front-burner/no-template-calls 2'
    ]);
  });

  it('keeps only attribute-layout and prefer-control-flow for the inline templates of specs', async () => {
    expect(await reported(component(specHostTemplate), 'app/x.spec.ts')).toEqual([
      '@angular-eslint/template/prefer-control-flow 2',
      'front-burner/attribute-layout 2'
    ]);
  });

  it('keeps only attribute-layout and prefer-control-flow for templates under testing/', async () => {
    expect(await reported(specHostTemplate, 'app/testing/host.component.html')).toEqual([
      '@angular-eslint/template/prefer-control-flow 2',
      'front-burner/attribute-layout 2'
    ]);
  });

  it('turns every template rule off for the inline templates of Storybook stories', async () => {
    expect(await reported(component(specHostTemplate), 'app/x.component.stories.ts')).toEqual([]);
  });

  describe('attribute-layout in inline templates', () => {
    /** The text of `code` after ESLint's fixes, linted as a component file. */
    async function fixedText(code) {
      const fixer = new ESLint({
        cwd: import.meta.dirname,
        overrideConfigFile: true,
        overrideConfig: [ ...nx.configs['flat/angular'], ...nx.configs['flat/angular-template'], ...angularTemplates ],
        fix: true
      });
      const [ result ] = await fixer.lintText(code, { filePath: 'app/x.component.ts' });
      return result.output ?? code;
    }

    it('fixes a tag on a later line of the template in place', async () => {
      const code = component(lines('', '    <a href="x" class="y">x</a>', '  '));

      expect(await fixedText(code)).toBe(component(lines('', '    <a href="x"', '       class="y">x</a>', '  ')));
    });

    it('reports, but does not fix, a tag on the backtick\'s line', async () => {
      const code = component('<a href="x" class="y">x</a>');

      expect(await reported(code, 'app/x.component.ts')).toEqual([ 'front-burner/attribute-layout 2' ]);
      expect(await fixedText(code)).toBe(code);
    });

    it('accepts a tag on the backtick\'s line whose attributes align in the real file', async () => {
      const code = component(lines('<a href="x"', '                class="y">x</a>'));

      expect(await reported(code, 'app/x.component.ts')).toEqual([]);
    });

    it('reports further attributes of a tag on the backtick\'s line that do not align with each other', async () => {
      const code = component(lines('<a href="x"', '                class="y"', '               id="z">x</a>'));

      expect(await reported(code, 'app/x.component.ts')).toEqual([ 'front-burner/attribute-layout 2' ]);
    });
  });
});

describe('opt-in', () => {
  it('every Angular project lints its templates with angular-templates.config.mjs', () => {
    const root = join(import.meta.dirname, '../../..');
    const configs = execFileSync('git', [ 'ls-files', '*eslint.config.mjs' ], { cwd: root, encoding: 'utf8' })
      .split('\n')
      .filter(Boolean);
    const missing = configs.filter(path => {
      const text = readFileSync(join(root, path), 'utf8');
      return text.includes('flat/angular-template') && !text.includes('angular-templates.config.mjs');
    });

    expect(missing).toEqual([]);
  });
});
