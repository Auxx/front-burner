import { lookup as dnsLookup, LookupAddress } from 'node:dns';
import { BlockList, isIP, isIPv4, isIPv6 } from 'node:net';
import { promisify } from 'node:util';

/** The operator's choice of AR-57. */
export interface EgressOptions {
  /** `FRONT_BURNER_BLOCK_PRIVATE_NETWORKS`: also refuse private and loopback addresses. */
  blockPrivateNetworks: boolean;
}

export type AddressVerdict = 'allowed' | 'reserved' | 'private';

/** Resolves a host name to every address it has. */
export type Lookup = (host: string) => Promise<LookupAddress[]>;

/** An outbound connection was refused before it was made (AR-57, A-5.8). */
export class EgressRefusedError extends Error {
  constructor(readonly reason: 'invalid-host' | 'not-found' | 'blocked', readonly host: string) {
    super(`Outbound connection to ${host} refused: ${reason}`);
    this.name = 'EgressRefusedError';
  }
}

function blockList(entries: [ string, number ][]): BlockList {
  const list = new BlockList();
  for (const [ address, prefix ] of entries) {
    list.addSubnet(address, prefix, isIPv6(address) ? 'ipv6' : 'ipv4');
  }
  return list;
}

// Always refused: link-local (cloud metadata, AR-57), plus addresses that are
// never a git server: "this network", unspecified, multicast and reserved (A-5.8).
const RESERVED = blockList([
  [ '169.254.0.0', 16 ],
  [ 'fe80::', 10 ],
  [ '0.0.0.0', 8 ],
  [ '::', 128 ],
  [ '224.0.0.0', 4 ],
  [ '240.0.0.0', 4 ],
  [ 'ff00::', 8 ]
]);

// Refused with FRONT_BURNER_BLOCK_PRIVATE_NETWORKS, including carrier-grade NAT
// and the deprecated site-local range (A-5.8).
const PRIVATE = blockList([
  [ '10.0.0.0', 8 ],
  [ '172.16.0.0', 12 ],
  [ '192.168.0.0', 16 ],
  [ '100.64.0.0', 10 ],
  [ '127.0.0.0', 8 ],
  [ 'fc00::', 7 ],
  [ 'fec0::', 10 ],
  [ '::1', 128 ]
]);

// A DNS name of at most 253 characters, labels of 1 to 63 letters, digits and
// inner hyphens, with an optional final dot.
const HOST_NAME =
  /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*\.?$/;

/** The eight 16-bit words of an IPv6 address. */
function words(address: string): number[] {
  let text = address.split('%')[0] ?? '';
  const dotted = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (dotted) {
    const [ a, b, c, d ] = dotted.slice(1).map(Number) as [ number, number, number, number ];
    text = `${text.slice(0, -dotted[0].length)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [ head, tail ] = text.split('::');
  const first = head ? head.split(':') : [];
  const last = tail ? tail.split(':') : [];
  const fill = tail === undefined ? [] : Array<string>(8 - first.length - last.length).fill('0');
  return [ ...first, ...fill, ...last ].map(word => parseInt(word, 16));
}

/** The IPv4 address that an IPv6 address reaches: IPv4-mapped, NAT64 or 6to4. */
function embeddedIPv4(address: string): string | undefined {
  if (!isIPv6(address)) {
    return undefined;
  }
  const w = words(address);
  const ipv4 = (high: number, low: number) => `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
  if (w.slice(0, 5).every(word => word === 0) && w[5] === 0xffff) {
    return ipv4(w[6] ?? 0, w[7] ?? 0);
  }
  if (w[0] === 0x64 && w[1] === 0xff9b) {
    return ipv4(w[6] ?? 0, w[7] ?? 0);
  }
  if (w[0] === 0x2002) {
    return ipv4(w[1] ?? 0, w[2] ?? 0);
  }
  return undefined;
}

/** Whether an outbound connection may go to an IP address (AR-57, A-5.8). */
export function checkAddress(address: string, options: EgressOptions): AddressVerdict {
  const candidates: [ string, 'ipv4' | 'ipv6' ][] = [ [ address, isIPv4(address) ? 'ipv4' : 'ipv6' ] ];
  const ipv4 = embeddedIPv4(address);
  if (ipv4 !== undefined) {
    candidates.push([ ipv4, 'ipv4' ]);
  }
  if (candidates.some(([ candidate, family ]) => RESERVED.check(candidate, family))) {
    return 'reserved';
  }
  if (options.blockPrivateNetworks && candidates.some(([ candidate, family ]) => PRIVATE.check(candidate, family))) {
    return 'private';
  }
  return 'allowed';
}

/** A DNS name or an IP address; the caller removes the brackets around an IPv6 address. */
export function isValidHost(host: string): boolean {
  return isIP(host) !== 0 || HOST_NAME.test(host);
}

const systemLookup: Lookup = host =>
  promisify(dnsLookup)(host, { all: true, order: 'verbatim' }) as Promise<LookupAddress[]>;

/**
 * Resolves a host to the addresses an outbound connection may use. A name is
 * refused when **any** of its addresses is not allowed (A-5.8), so that a
 * retry cannot reach the other one.
 *
 * @throws EgressRefusedError
 */
export async function resolveAllowed(
  host: string,
  options: EgressOptions,
  lookup: Lookup = systemLookup
): Promise<LookupAddress[]> {
  if (!isValidHost(host)) {
    throw new EgressRefusedError('invalid-host', host);
  }
  let addresses: LookupAddress[];
  const family = isIP(host);
  if (family !== 0) {
    addresses = [ { address: host, family } ];
  } else {
    try {
      addresses = await lookup(host);
    } catch {
      throw new EgressRefusedError('not-found', host);
    }
  }
  if (addresses.length === 0) {
    throw new EgressRefusedError('not-found', host);
  }
  if (addresses.some(({ address }) => checkAddress(address, options) !== 'allowed')) {
    throw new EgressRefusedError('blocked', host);
  }
  return addresses;
}
