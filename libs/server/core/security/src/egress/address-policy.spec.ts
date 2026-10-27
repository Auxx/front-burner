import type { LookupAddress } from 'node:dns';
import { checkAddress, EgressRefusedError, isValidHost, Lookup, resolveAllowed } from './address-policy';

const OPEN = { blockPrivateNetworks: false };
const CLOSED = { blockPrivateNetworks: true };

function fakeLookup(addresses: string[]): Lookup & { calls: string[]; } {
  const calls: string[] = [];
  const lookup = async (host: string): Promise<LookupAddress[]> => {
    calls.push(host);
    return addresses.map(address => ({ address, family: address.includes(':') ? 6 : 4 }));
  };
  return Object.assign(lookup, { calls });
}

async function refusalOf(promise: Promise<unknown>): Promise<EgressRefusedError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(EgressRefusedError);
    return error as EgressRefusedError;
  }
  throw new Error('the promise did not reject');
}

describe('checkAddress', () => {
  it('refuses link-local and reserved addresses', () => {
    for (const address of [ '169.254.169.254', 'fe80::1', '0.0.0.0', '::', '224.0.0.1', '240.0.0.1', 'ff02::1' ]) {
      expect(checkAddress(address, OPEN)).toBe('reserved');
      expect(checkAddress(address, CLOSED)).toBe('reserved');
    }
  });

  it('refuses embedded IPv4 forms', () => {
    for (const address of [ '::ffff:169.254.169.254', '64:ff9b::a9fe:a9fe', '2002:a9fe:a9fe::' ]) {
      expect(checkAddress(address, OPEN)).toBe('reserved');
    }
  });

  it('allows private and loopback addresses by default', () => {
    for (const address of [ '10.0.0.1', '192.168.1.1', '127.0.0.1', '::1', 'fd00::1', '100.64.0.1' ]) {
      expect(checkAddress(address, OPEN)).toBe('allowed');
    }
  });

  it('refuses them with the switch', () => {
    for (const address of [ '10.0.0.1', '192.168.1.1', '127.0.0.1', '::1', 'fd00::1', '100.64.0.1', 'fec0::1' ]) {
      expect(checkAddress(address, CLOSED)).toBe('private');
    }
  });

  it('allows public addresses', () => {
    for (const address of [ '140.82.112.3', '2606:4700::1111' ]) {
      expect(checkAddress(address, OPEN)).toBe('allowed');
      expect(checkAddress(address, CLOSED)).toBe('allowed');
    }
  });
});

describe('isValidHost', () => {
  it('accepts names and IP addresses', () => {
    for (const host of [ 'github.com', 'git-server', 'a.b-c.example', '10.0.0.1', '::1' ]) {
      expect(isValidHost(host)).toBe(true);
    }
  });

  it('refuses anything else', () => {
    for (const host of [ '', 'a b', '-x.com', 'x-.com', 'a..b', 'x'.repeat(254), `${'x'.repeat(64)}.com` ]) {
      expect(isValidHost(host)).toBe(false);
    }
  });
});

describe('resolveAllowed', () => {
  it('gives every address of an allowed name', async () => {
    const lookup = fakeLookup([ '140.82.112.3', '2606:4700::1111' ]);
    const addresses = await resolveAllowed('github.com', OPEN, lookup);
    expect(addresses.map(a => a.address)).toEqual([ '140.82.112.3', '2606:4700::1111' ]);
    expect(lookup.calls).toEqual([ 'github.com' ]);
  });

  it('gives an IP address without resolving it', async () => {
    const lookup = fakeLookup([]);
    expect(await resolveAllowed('140.82.112.3', OPEN, lookup)).toEqual([ { address: '140.82.112.3', family: 4 } ]);
    expect(await resolveAllowed('::1', OPEN, lookup)).toEqual([ { address: '::1', family: 6 } ]);
    expect(lookup.calls).toEqual([]);
  });

  it('refuses a blocked IP address', async () => {
    const refusal = await refusalOf(resolveAllowed('127.0.0.1', CLOSED, fakeLookup([])));
    expect(refusal.reason).toBe('blocked');
    expect(refusal.host).toBe('127.0.0.1');
  });

  it('refuses a name with any blocked address', async () => {
    const refusal = await refusalOf(
      resolveAllowed('evil.example', OPEN, fakeLookup([ '140.82.112.3', '169.254.169.254' ]))
    );
    expect(refusal.reason).toBe('blocked');
    expect(refusal.host).toBe('evil.example');
  });

  it('refuses a name without addresses', async () => {
    expect((await refusalOf(resolveAllowed('none.example', OPEN, fakeLookup([])))).reason).toBe('not-found');
  });

  it('reports a failed lookup as not found', async () => {
    const failing: Lookup = () =>
      Promise.reject(Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }));
    expect((await refusalOf(resolveAllowed('none.example', OPEN, failing))).reason).toBe('not-found');
  });

  it('refuses an invalid host before resolving', async () => {
    const lookup = fakeLookup([ '140.82.112.3' ]);
    for (const host of [ 'a b', '-x.com', 'x'.repeat(254) ]) {
      expect((await refusalOf(resolveAllowed(host, OPEN, lookup))).reason).toBe('invalid-host');
    }
    expect(lookup.calls).toEqual([]);
  });

  it('resolves a numeric host form', async () => {
    // 2852039166 is 169.254.169.254 written as one number.
    expect((await refusalOf(resolveAllowed('2852039166', OPEN))).reason).toBe('blocked');
  });
});
