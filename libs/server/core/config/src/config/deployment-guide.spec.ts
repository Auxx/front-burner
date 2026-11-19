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
 * The variables without a default. A new variable must be added here or given
 * a default that {@link CONFIG_DEFAULTS} finds, so that no default is missed.
 */
const WITHOUT_DEFAULT = [
  'FRONT_BURNER_REPOS_DIR',
  'FRONT_BURNER_SETUP_TOKEN',
  'FRONT_BURNER_SETUP_TOKEN_FILE',
  'FRONT_BURNER_JWT_SECRET',
  'FRONT_BURNER_JWT_SECRET_FILE',
  'FRONT_BURNER_ENCRYPTION_KEY',
  'FRONT_BURNER_ENCRYPTION_KEY_FILE',
  'FRONT_BURNER_ENCRYPTION_KEY_RESET',
  'FRONT_BURNER_KNOWN_HOSTS_FILE',
  'FRONT_BURNER_OIDC_ISSUER',
  'FRONT_BURNER_OIDC_CLIENT_ID',
  'FRONT_BURNER_OIDC_CLIENT_SECRET',
  'FRONT_BURNER_OIDC_CLIENT_SECRET_FILE',
  'FRONT_BURNER_ADMIN_EMAIL',
  'FRONT_BURNER_OIDC_REQUIRED_CLAIM_NAME',
  'FRONT_BURNER_OIDC_REQUIRED_CLAIM_VALUE',
  'FRONT_BURNER_METRICS_TOKEN',
  'FRONT_BURNER_METRICS_TOKEN_FILE'
];

/** A variable's row in one of the guide's tables, by column name. */
type Row = Record<string, string>;

function cellsOf(line: string): string[] {
  return line.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim());
}

/** Every table row of the guide whose first cell is a variable, by the variable's name. */
function tableRows(): Map<string, Row> {
  const rows = new Map<string, Row>();
  const lines = GUIDE.split('\n');
  let header: string[] = [];
  lines.forEach((line, index) => {
    if (!line.startsWith('|')) {
      header = [];
      return;
    }
    if (/^\|\s*-/.test(lines[index + 1] ?? '')) {
      header = cellsOf(line);
      return;
    }
    const cells = cellsOf(line);
    const variable = /^`(FRONT_BURNER_[A-Z0-9_]+)`$/.exec(cells[0] ?? '')?.[1];
    if (variable !== undefined && header.length > 0) {
      rows.set(variable, Object.fromEntries(header.map((name, column) => [ name, cells[column] ?? '' ])));
    }
  });
  return rows;
}

/**
 * The default a row gives: its Default cell or, in a table without that
 * column (as the OIDC table, whose second column is Required), "Default `…`"
 * in its Meaning cell.
 */
function defaultIn(row: Row): string | undefined {
  if ('Default' in row) {
    return row['Default'];
  }
  const value = /Default (`[^`]+`)/.exec(row['Meaning'] ?? '')?.[1];
  return value;
}

/**
 * Every whole variable name in the guide. A name followed by `_` or `*`, as in
 * "other `FRONT_BURNER_OIDC_*` variables", is a prefix, not a variable.
 */
function namesInGuide(): Set<string> {
  return new Set(GUIDE.match(/FRONT_BURNER_[A-Z0-9_]*[A-Z0-9](?![A-Z0-9_*])/g) ?? []);
}

describe('the deployment guide', () => {
  it('every variable the backend reads is in the deployment guide', () => {
    const rows = tableRows();

    expect(CONFIG_VARIABLES.filter(variable => !rows.has(variable))).toEqual([]);
  });

  it('every variable in the deployment guide is read by the backend', () => {
    const known = new Set(CONFIG_VARIABLES);

    expect([ ...namesInGuide() ].filter(name => !known.has(name))).toEqual([]);
  });

  it('the guide\'s defaults are the schema\'s', () => {
    const rows = tableRows();
    const wrong = Object.entries(CONFIG_DEFAULTS)
      .filter(([ variable, value ]) => {
        const row = rows.get(variable);
        return row === undefined || defaultIn(row) !== `\`${value}\``;
      })
      .map(([ variable, value ]) => `${variable}: \`${value}\``);

    expect(wrong).toEqual([]);
  });

  it('knows the default of every variable that has one', () => {
    expect(CONFIG_VARIABLES.filter(variable => !(variable in CONFIG_DEFAULTS))).toEqual(WITHOUT_DEFAULT);
  });
});
