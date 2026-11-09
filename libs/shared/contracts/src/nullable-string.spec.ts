import { z } from 'zod';
import * as contracts from './index';
import { nullableString } from './nullable-string';

/** Where a JSON schema has a list of types, which the OpenAPI document can't describe. */
function typeLists(node: unknown, path: string): string[] {
  if (Array.isArray(node)) {
    return node.flatMap((item, index) => typeLists(item, `${path}[${index}]`));
  }
  if (typeof node !== 'object' || node === null) {
    return [];
  }
  const own = Array.isArray((node as { type?: unknown; }).type) ? [ path ] : [];
  return [ ...own, ...Object.entries(node).flatMap(([ key, value ]) => typeLists(value, `${path}/${key}`)) ];
}

describe('nullableString', () => {
  it('takes a string or null, and nothing else', () => {
    expect(nullableString().parse('main')).toBe('main');
    expect(nullableString().parse(null)).toBeNull();
    expect(nullableString().safeParse(undefined).success).toBe(false);
    expect(nullableString().safeParse(1).success).toBe(false);
  });

  it('has a JSON schema that OpenAPI 3.0 can describe', () => {
    const { type, nullable } = z.toJSONSchema(nullableString()) as { type: unknown; nullable: unknown; };
    expect({ type, nullable }).toEqual({ type: 'string', nullable: true });
  });

  it('finds a list of types, as the check below relies on it', () => {
    const bare = z.toJSONSchema(z.object({ name: z.string().nullable() }));
    expect(typeLists(bare, 'bare')).toEqual([ 'bare/properties/name' ]);
  });

  it('is what every schema of this library uses', () => {
    const schemas = Object.entries(contracts).filter(([ , value ]) => value instanceof z.ZodType) as [
      string,
      z.ZodType
    ][];

    expect(schemas.length).toBeGreaterThan(50);
    const found = schemas.flatMap(([ name, schema ]) =>
      typeLists(z.toJSONSchema(schema, { unrepresentable: 'any', io: 'output' }), name)
    );
    expect(found).toEqual([]);
  });
});
