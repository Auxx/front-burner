import * as contracts from '@front-burner/shared-contracts';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';

const generatedDir = join(import.meta.dirname, 'generated');
const importPattern = /import type \{([^}]*)\} from '@front-burner\/shared-contracts'/g;
const anyImportPattern = /^import (?!type\b)[^;]*?from '@front-burner\/shared-contracts'/m;

/** Names the generated clients import from the contracts, per file. */
function importedNames(dir: string): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const file of readdirSync(dir).filter(f => f.endsWith('.ts') && !f.endsWith('.spec.ts'))) {
    const source = readFileSync(join(dir, file), 'utf8');
    const names = [ ...source.matchAll(importPattern) ]
      .flatMap(match => (match[1] ?? '').split(','))
      // `A as B` imports the contracts name A.
      .map(name => (name.trim().split(/\s+as\s+/)[0] ?? '').trim())
      .filter(Boolean);
    result.set(file, names);
  }
  return result;
}

function unresolved(imports: Map<string, string[]>): string[] {
  const exported = contracts as Record<string, unknown>;
  return [ ...imports ].flatMap(([ file, names ]) =>
    names
      .filter(name => {
        const schema = exported[`${name}Schema`];
        return !schema || z.globalRegistry.get(schema as z.ZodType)?.id !== name;
      })
      .map(name => `${file}: ${name}`)
  );
}

/** Files that import from the contracts without `import type`, which would pull zod into the client bundle. */
function valueImports(dir: string): string[] {
  return readdirSync(dir)
    .filter(f => f.endsWith('.ts') && !f.endsWith('.spec.ts'))
    .filter(f => anyImportPattern.test(readFileSync(join(dir, f), 'utf8')));
}

describe('generated client imports from shared-contracts', () => {
  it('imports only types that have a contracts schema with the same registry id', () => {
    const imports = importedNames(generatedDir);
    expect([ ...imports.values() ].flat()).toContain('HealthStatus');
    expect(unresolved(imports)).toEqual([]);
  });

  it('reports a name that the contracts do not provide', () => {
    const imports = new Map([ [ 'Bogus.ts', [ 'HealthStatus', 'NoSuchThing' ] ] ]);
    expect(unresolved(imports)).toEqual([ 'Bogus.ts: NoSuchThing' ]);
  });

  it('checks the original name of an aliased import', () => {
    const source = `import type { HealthStatus as Status, Nope as Other } from '@front-burner/shared-contracts';`;
    const dir = mkdtempSync(join(tmpdir(), 'contracts-'));
    try {
      writeFileSync(join(dir, 'A.ts'), source);
      expect(importedNames(dir).get('A.ts')).toEqual([ 'HealthStatus', 'Nope' ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('imports from the contracts with import type only', () => {
    expect(valueImports(generatedDir)).toEqual([]);
  });

  it('reports a value import from the contracts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'contracts-'));
    try {
      writeFileSync(join(dir, 'A.ts'), `import { HealthStatus } from '@front-burner/shared-contracts';\n`);
      writeFileSync(join(dir, 'B.ts'), `import type { HealthStatus } from '@front-burner/shared-contracts';\n`);
      expect(valueImports(dir)).toEqual([ 'A.ts' ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
