import { type AddressAttribute, SAFE_HTML, type SafeHtmlWhitelist } from './safe-html';

/** An address that may stay, as the browser will read it, or the scheme that removes it. */
export type AddressCheck = { allowed: true; value: string; } | { allowed: false; scheme: string; };

/** The key of a scheme that is not even a valid scheme name, so that a removal report never shows file text. */
export const INVALID_SCHEME = 'invalid';

const ADDRESS_ATTRIBUTES: readonly string[] = [ 'href', 'src', 'srcset', 'cite' ] satisfies AddressAttribute[];

export function isAddressAttribute(attribute: string): attribute is AddressAttribute {
  return ADDRESS_ATTRIBUTES.includes(attribute);
}

/**
 * Checks an address attribute's value against SH-15 and SH-16, reading it as
 * the URL parser does: without leading and trailing spaces or control
 * characters and without tabs and line breaks, so that `jav&#x09;ascript:`
 * counts as `javascript:`. An allowed value comes back with its scheme in
 * lower case and a protocol-relative address as `https:`, so that both
 * sanitising steps read it the same way. A `srcset` is allowed only when
 * every one of its addresses is.
 */
export function checkAddress(
  attribute: AddressAttribute,
  value: string,
  whitelist: SafeHtmlWhitelist = SAFE_HTML
): AddressCheck {
  const protocols = whitelist.protocols[attribute];
  if (attribute !== 'srcset') {
    return checkUrl(value, protocols);
  }
  const candidates: string[] = [];
  for (const candidate of value.split(',')) {
    const [ url = '', ...descriptors ] = candidate.trim().split(/\s+/);
    if (!url) {
      continue;
    }
    const check = checkUrl(url, protocols);
    if (!check.allowed) {
      return check;
    }
    candidates.push([ check.value, ...descriptors ].join(' '));
  }
  return { allowed: true, value: candidates.join(', ') };
}

function checkUrl(value: string, protocols: readonly string[]): AddressCheck {
  // eslint-disable-next-line no-control-regex -- the URL parser strips exactly these.
  let url = value.replace(/^[\x00-\x20]+|[\x00-\x20]+$/g, '').replace(/[\t\n\r]/g, '');
  if (/^[\\/]{2}/.test(url)) {
    url = `https://${url.slice(2)}`;
  }
  const colon = url.indexOf(':');
  const end = url.search(/[/?#]/);
  if (colon < 0 || (end >= 0 && end < colon)) {
    return { allowed: true, value: url };
  }
  const scheme = url.slice(0, colon).toLowerCase();
  if (protocols.includes(scheme)) {
    return { allowed: true, value: scheme + url.slice(colon) };
  }
  return { allowed: false, scheme: /^[a-z][a-z\d+.-]{0,31}$/.test(scheme) ? scheme : INVALID_SCHEME };
}
