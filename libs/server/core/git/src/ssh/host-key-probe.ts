import { EgressOptions, EgressRefusedError, Lookup, resolveAllowed } from '@front-burner/server-core-security';
import type { LookupAddress } from 'node:dns';
import type { Socket } from 'node:net';
import { Client } from 'ssh2';
import { connectTo } from '../egress/egress-proxy';
import { GitOperationError } from '../engine/git-errors';
import type { HostKey } from './known-hosts';
import { fingerprintOf } from './ssh-keys';
import { WireReader } from './wire';

const PROBE_TIMEOUT_MS = 15_000;

/** OpenSSH's default order for a host it does not know, so the probe sees the key `ssh` would. */
const HOST_KEY_ALGORITHMS = [
  'ssh-ed25519',
  'ecdsa-sha2-nistp256',
  'ecdsa-sha2-nistp384',
  'ecdsa-sha2-nistp521',
  'rsa-sha2-512',
  'rsa-sha2-256'
] as const;

async function connectToAllowed(host: string, port: number, egress: EgressOptions, lookup?: Lookup): Promise<Socket> {
  let addresses: LookupAddress[];
  try {
    addresses = await resolveAllowed(host, egress, lookup);
  } catch (error) {
    if (error instanceof EgressRefusedError) {
      throw new GitOperationError('host-unreachable', `host key probe refused: ${error.reason}`, { host });
    }
    throw error;
  }
  for (const { address } of addresses) {
    try {
      return await connectTo(address, port, PROBE_TIMEOUT_MS);
    } catch {
      // Try the next checked address.
    }
  }
  throw new GitOperationError('host-unreachable', 'host key probe could not connect', { host });
}

/**
 * Fetches the host key of an SSH server that is not known yet, so that the
 * user can decide whether to trust it (AR-32, A-5.6). The connection goes
 * only to addresses the AR-57 rules allow; the handshake stops at the host
 * key, so no login is attempted.
 *
 * @throws GitOperationError `host-unreachable`
 */
export async function probeHostKey(
  remote: { host: string; port: number; },
  egress: EgressOptions,
  lookup?: Lookup
): Promise<HostKey> {
  const socket = await connectToAllowed(remote.host, remote.port, egress, lookup);
  return new Promise((resolve, reject) => {
    let blob: Buffer | undefined;
    const client = new Client();
    const timer = setTimeout(() => finish(), PROBE_TIMEOUT_MS);
    const finish = () => {
      clearTimeout(timer);
      client.end();
      socket.destroy();
      if (blob === undefined) {
        reject(new GitOperationError('host-unreachable', 'no SSH host key received', { host: remote.host }));
        return;
      }
      const type = new WireReader(blob).string().toString();
      const key = blob.toString('base64');
      resolve({ host: remote.host, port: remote.port, type, key, fingerprint: fingerprintOf(`${type} ${key}`) });
    };
    client.on('error', finish);
    client.on('close', finish);
    client.connect({
      sock: socket,
      // Required by ssh2; the handshake ends before any login.
      username: 'probe',
      readyTimeout: PROBE_TIMEOUT_MS,
      algorithms: { serverHostKey: [ ...HOST_KEY_ALGORITHMS ] },
      hostVerifier: (key: Buffer) => {
        blob = key;
        return false;
      }
    });
  });
}
