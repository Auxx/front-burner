import { type ApiError, type HostKey, HostKeySchema } from '@front-burner/shared-contracts';

/** The host key of an unknown SSH server, if that is why a request failed (AR-32). */
export function unknownHostKey(apiError: ApiError): HostKey | undefined {
  if (apiError.code !== 'host-key-unknown') {
    return undefined;
  }
  const parsed = HostKeySchema.safeParse(apiError.params);
  return parsed.success ? parsed.data : undefined;
}

const SSH_PORT = 22;

/**
 * A server as the host key dialogs show it: the host, and the port unless it
 * is SSH's own, with an IPv6 address in brackets before a port, as in
 * `[fd00::1]:2222`.
 */
export function hostLabel(host: string, port: number): string {
  if (port === SSH_PORT) {
    return host;
  }
  return host.includes(':') ? `[${host}]:${port}` : `${host}:${port}`;
}
