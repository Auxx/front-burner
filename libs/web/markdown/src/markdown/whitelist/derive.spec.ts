import { checkAddress } from './addresses';
import { attributeOf, purifyConfig, sanitizeSchema } from './derive';
import { SAFE_HTML } from './safe-html';

/** The HTML names of a schema's attribute definitions. */
function schemaAttributes(): Set<string> {
  const attributes = Object.values(sanitizeSchema().attributes ?? {}).flat();
  return new Set(
    attributes.map(definition => attributeOf(typeof definition === 'string' ? definition : definition[0]))
  );
}

const WHITELIST_ATTRIBUTES = new Set([ ...SAFE_HTML.globalAttributes, ...Object.values(SAFE_HTML.attributes).flat() ]);
const PIPELINE_ATTRIBUTES = new Set(Object.values(SAFE_HTML.pipeline.attributes).flat());

describe('sanitizeSchema and purifyConfig', () => {
  it('derives both configurations from the same whitelist', () => {
    const schema = sanitizeSchema();
    const config = purifyConfig();

    expect(new Set(schema.tagNames)).toEqual(new Set(SAFE_HTML.tags));
    expect(new Set(config.ALLOWED_TAGS)).toEqual(new Set(SAFE_HTML.tags));
    expect(new Set(schema.strip)).toEqual(new Set(SAFE_HTML.contentRemovedTags));
    expect(new Set(config.FORBID_CONTENTS)).toEqual(new Set(SAFE_HTML.contentRemovedTags));

    expect(schemaAttributes()).toEqual(WHITELIST_ATTRIBUTES);
    // Only DOMPurify lists the pipeline's names, which the first step adds back itself.
    expect(new Set(config.ALLOWED_ATTR)).toEqual(new Set([ ...WHITELIST_ATTRIBUTES, ...PIPELINE_ATTRIBUTES ]));
    for (const name of PIPELINE_ATTRIBUTES) {
      if (!WHITELIST_ATTRIBUTES.has(name)) {
        expect(schemaAttributes()).not.toContain(name);
      }
    }

    expect(schema.protocols).toEqual({
      href: [ 'http', 'https', 'mailto' ],
      src: [ 'http', 'https' ],
      srcSet: [ 'http', 'https' ],
      cite: [ 'http', 'https' ]
    });
    expect(schema.clobberPrefix).toBe(SAFE_HTML.idPrefix);
    expect(schema.ancestors).toEqual({ source: [ 'picture' ] });
    expect(schema.required).toEqual({ input: { disabled: true } });
    expect(schema.allowComments).toBe(false);
    expect(config.ALLOW_DATA_ATTR).toBe(false);
    expect(config.ALLOW_ARIA_ATTR).toBe(false);
    expect(config.SANITIZE_NAMED_PROPS).toBe(false);
  });

  it('never allows style, on… or class except as SH-11 says', () => {
    const names = [ ...schemaAttributes(), ...(purifyConfig().ALLOWED_ATTR ?? []) ];

    expect(names).not.toContain('style');
    expect(names.filter(name => name.startsWith('on'))).toEqual([]);
    expect(Object.entries(SAFE_HTML.attributes).filter(([ , attributes ]) => attributes.includes('class'))).toEqual([
      [ 'code', [ 'class' ] ]
    ]);
    expect(SAFE_HTML.values['class']?.test('language-ts')).toBe(true);
    expect(SAFE_HTML.values['class']?.test('evil')).toBe(false);
    expect(SAFE_HTML.globalAttributes).not.toContain('class');
  });

  it('lists SH-7\'s forbidden tags nowhere', () => {
    const forbidden = [
      'script',
      'noscript',
      'style',
      'link',
      'meta',
      'base',
      'title',
      'iframe',
      'frame',
      'frameset',
      'object',
      'embed',
      'applet',
      'form',
      'button',
      'select',
      'option',
      'textarea',
      'template',
      'slot',
      'dialog',
      'svg',
      'math',
      'canvas',
      'video',
      'audio'
    ];
    const listed = [ ...SAFE_HTML.tags, ...(sanitizeSchema().tagNames ?? []), ...(purifyConfig().ALLOWED_TAGS ?? []) ];

    expect(listed.filter(tag => forbidden.includes(tag))).toEqual([]);
    expect(Object.keys(SAFE_HTML.attributes).filter(tag => forbidden.includes(tag))).toEqual([]);
  });
});

describe('checkAddress', () => {
  it.each(
    [
      [ 'href', 'https://example.com', 'https://example.com' ],
      [ 'href', 'HTTP://example.com', 'http://example.com' ],
      [ 'href', 'mailto:me@example.com', 'mailto:me@example.com' ],
      [ 'href', '#install', '#install' ],
      [ 'href', 'docs/a:b.md', 'docs/a:b.md' ],
      [ 'href', '//example.com', 'https://example.com' ],
      [ 'src', ' logo.png ', 'logo.png' ],
      [ 'srcset', 'a.png 1x, //cdn.example.com/b.png 2x', 'a.png 1x, https://cdn.example.com/b.png 2x' ]
    ] as const
  )('keeps %s="%s"', (attribute, value, expected) => {
    expect(checkAddress(attribute, value)).toEqual({ allowed: true, value: expected });
  });

  it.each(
    [
      [ 'href', 'javascript:alert(1)', 'javascript' ],
      [ 'href', 'JaVaScRiPt:alert(1)', 'javascript' ],
      [ 'href', 'jav\tascript:alert(1)', 'javascript' ],
      [ 'href', '\u0001 javascript:alert(1)', 'javascript' ],
      [ 'href', 'data:text/html,x', 'data' ],
      [ 'src', 'mailto:me@example.com', 'mailto' ],
      [ 'cite', 'file:///etc/passwd', 'file' ],
      [ 'srcset', 'a.png 1x, javascript:x 2x', 'javascript' ],
      [ 'href', 'a b<i>:y', 'invalid' ]
    ] as const
  )('removes %s="%s"', (attribute, value, scheme) => {
    expect(checkAddress(attribute, value)).toEqual({ allowed: false, scheme });
  });
});
