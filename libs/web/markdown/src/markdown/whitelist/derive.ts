import type { Config } from 'dompurify';
import { find, html } from 'property-information';
import type { Options as Schema } from 'rehype-sanitize';
import { isAddressAttribute } from './addresses';
import { SAFE_HTML, type SafeHtmlWhitelist } from './safe-html';

type PropertyDefinition = NonNullable<Schema['attributes']>[string][number];

/** The hast property name of an HTML attribute, such as `colSpan` for `colspan`. */
export function propertyOf(attribute: string): string {
  return find(html, attribute).property;
}

/** The HTML attribute name of a hast property, such as `colspan` for `colSpan`. */
export function attributeOf(property: string): string {
  return find(html, property).attribute;
}

const allowedByWhitelist = new WeakMap<SafeHtmlWhitelist, Map<string, ReadonlySet<string>>>();

/** Every attribute the whitelist allows on `tag`, in the file's own HTML (SH-11, SH-12). */
export function allowedAttributes(tag: string, whitelist: SafeHtmlWhitelist = SAFE_HTML): ReadonlySet<string> {
  let byTag = allowedByWhitelist.get(whitelist);
  if (!byTag) {
    byTag = new Map();
    allowedByWhitelist.set(whitelist, byTag);
  }
  let allowed = byTag.get(tag);
  if (!allowed) {
    allowed = new Set([ ...whitelist.globalAttributes, ...(whitelist.attributes[tag] ?? []) ]);
    byTag.set(tag, allowed);
  }
  return allowed;
}

/** `value` as an `id` or `name` with the whitelist's prefix, which it gets only once (SH-14). */
export function withIdPrefix(value: string, whitelist: SafeHtmlWhitelist = SAFE_HTML): string {
  return value.startsWith(whitelist.idPrefix) ? value : whitelist.idPrefix + value;
}

/** Whether an `input` of this `type` is allowed (SH-12); any other `input` is removed whole. */
export function isAllowedInputType(type: string, whitelist: SafeHtmlWhitelist = SAFE_HTML): boolean {
  return type.toLowerCase() === whitelist.input.type;
}

/**
 * The `rehype-sanitize` schema of the whitelist. It leaves out the pipeline's
 * own markup, which `rehypeSafeHtml` adds back to the elements the pipeline
 * made (SH-5). Every key is set, so that nothing falls back to the plugin's
 * GitHub defaults.
 */
export function sanitizeSchema(whitelist: SafeHtmlWhitelist = SAFE_HTML): Schema {
  const definition = (tag: string, attribute: string): PropertyDefinition => {
    const property = propertyOf(attribute);
    if (tag === 'input' && attribute === 'type') {
      return [ property, whitelist.input.type ];
    }
    const value = whitelist.values[attribute];
    return value ? [ property, value ] : property;
  };
  return {
    tagNames: [ ...whitelist.tags ],
    strip: [ ...whitelist.contentRemovedTags ],
    attributes: Object.fromEntries([
      [ '*', whitelist.globalAttributes.map(attribute => definition('*', attribute)) ],
      ...Object.entries(whitelist.attributes).map((
        [ tag, attributes ]
      ) => [ tag, attributes.map(attribute => definition(tag, attribute)) ])
    ]),
    ancestors: Object.fromEntries(
      Object.entries(whitelist.ancestors).map(([ tag, ancestors ]) => [ tag, [ ...ancestors ] ])
    ),
    required: { input: Object.fromEntries(whitelist.input.required.map(attribute => [ propertyOf(attribute), true ])) },
    protocols: Object.fromEntries(
      Object.entries(whitelist.protocols).map(([ attribute, protocols ]) => [ propertyOf(attribute), [ ...protocols ] ])
    ),
    clobber: [ 'id', 'name' ],
    clobberPrefix: whitelist.idPrefix,
    allowComments: false,
    allowDoctypes: false
  };
}

/**
 * The DOMPurify configuration of the whitelist. DOMPurify's lists are global,
 * so `purifyHtml`'s hooks apply what is per tag: attributes, values, classes,
 * `id` prefixes, ancestors and the checkbox. Unlike the first step, it allows
 * the pipeline's own markup, including what plan 29 adds after sanitising:
 * `sk-…` classes from highlighting and prefixed heading IDs.
 */
export function purifyConfig(whitelist: SafeHtmlWhitelist = SAFE_HTML): Config {
  const attributes = new Set([
    ...whitelist.globalAttributes,
    ...Object.values(whitelist.attributes).flat(),
    ...Object.values(whitelist.pipeline.attributes).flat(),
    'class'
  ]);
  const schemes = [ ...new Set(Object.values(whitelist.protocols).flat()) ].join('|');
  return {
    ALLOWED_TAGS: [ ...whitelist.tags ],
    ALLOWED_ATTR: [ ...attributes ],
    ALLOW_ARIA_ATTR: false,
    ALLOW_DATA_ATTR: false,
    ALLOW_UNKNOWN_PROTOCOLS: false,
    // A scheme of the whitelist, or no scheme at all: the shape of DOMPurify's
    // own default. The hooks then check each attribute's own schemes.
    ALLOWED_URI_REGEXP: new RegExp(`^(?:(?:${schemes}):|[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$))`, 'i'),
    // DOMPurify checks every other attribute against that pattern too, so
    // that `headers="row:1"` would lose its value; only addresses are checked.
    ADD_URI_SAFE_ATTR: [ ...attributes ].filter(attribute => !isAddressAttribute(attribute)),
    FORBID_CONTENTS: [ ...whitelist.contentRemovedTags ],
    KEEP_CONTENT: true,
    RETURN_TRUSTED_TYPE: true,
    SANITIZE_DOM: true,
    // The hooks add the prefix only where it is missing, so that an `id` of
    // the first step does not get it twice.
    SANITIZE_NAMED_PROPS: false
  };
}
