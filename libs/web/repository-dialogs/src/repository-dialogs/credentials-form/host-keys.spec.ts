import type { ApiError } from '@front-burner/shared-contracts';

import { unknownHostKey } from './host-keys';

const hostKey = { host: 'git.example.com', port: 22, type: 'ssh-ed25519', key: 'AAAA', fingerprint: 'SHA256:abc' };

function apiError(code: string, params: Record<string, unknown>): ApiError {
  return { code, params, message: code, requestId: '' };
}

describe('unknownHostKey', () => {
  it('reads the host key of an unknown server', () => {
    expect(unknownHostKey(apiError('host-key-unknown', hostKey))).toEqual(hostKey);
  });

  it('is undefined for any other failure, or a host key it can\'t read', () => {
    expect(unknownHostKey(apiError('host-key-changed', hostKey))).toBeUndefined();
    expect(unknownHostKey(apiError('host-key-unknown', { host: 'git.example.com' }))).toBeUndefined();
  });
});
