import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { CONFIG_DEFAULTS, CONFIG_VARIABLES } from './load-config';

/**
 * The deployment guide's "Environment variables" against the schema (A-1.15).
 * CI runs this on every change (`npm run check:guide`), since a change to the
 * guide alone affects no project.
 */
const GUIDE = readFileSync(resolve(import.meta.dirname, '../../../../../../docs/wiki/deployment.md'), 'utf8');

/**
 * Every whole variable name in the guide. A name followed by `_` or `*`, as in
 * "other `FRONT_BURNER_OIDC_*` variables", is a prefix, not a variable.
 */
function namesInGuide(): Set<string> {
  return new Set(GUIDE.match(/FRONT_BURNER_[A-Z0-9_]*[A-Z0-9](?![A-Z0-9_*])/g) ?? []);
}

/** The guide's table row for a variable: the line that starts with its name. */
function rowOf(variable: string): string | undefined {
  return GUIDE.split('\n').find(line => line.startsWith(`| \`${variable}\``));
}

describe('the deployment guide', () => {
  it('every variable the backend reads is in the deployment guide', () => {
    const names = namesInGuide();

    expect(CONFIG_VARIABLES.filter(variable => !names.has(variable))).toEqual([]);
  });

  it('every variable in the deployment guide is read by the backend', () => {
    const known = new Set(CONFIG_VARIABLES);

    expect([ ...namesInGuide() ].filter(name => !known.has(name))).toEqual([]);
  });

  it('the guide\'s defaults are the schema\'s', () => {
    const wrong = Object.entries(CONFIG_DEFAULTS)
      .filter(([ variable, value ]) => !rowOf(variable)?.includes(`\`${value}\``))
      .map(([ variable, value ]) => `${variable}: \`${value}\``);

    expect(wrong).toEqual([]);
  });
});
