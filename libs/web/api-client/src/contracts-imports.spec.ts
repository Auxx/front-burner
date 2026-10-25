import * as contracts from '@front-burner/shared-contracts';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

const generatedDir = join(import.meta.dirname, 'generated');
const importPattern = /import type \{([^}]*)\} from '@front-burner\/shared-contracts'/g;

/** Names the generated clients import from the contracts, per file. */
function importedNames(dir: string): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const file of readdirSync(dir).filter(f => f.endsWith('.ts') && !f.endsWith('.spec.ts'))) {
    const source = readFileSync(join(dir, file), 'utf8');
    const names = [ ...source.matchAll(importPattern) ]
      .flatMap(match => (match[1] ?? '').split(','))
      .map(name => name.trim())
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
});
