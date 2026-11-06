import { type ApiError, type HostKey, HostKeySchema } from '@front-burner/shared-contracts';

/** The host key of an unknown SSH server, if that is why a request failed (AR-32). */
export function unknownHostKey(apiError: ApiError): HostKey | undefined {
  if (apiError.code !== 'host-key-unknown') {
    return undefined;
  }
  const parsed = HostKeySchema.safeParse(apiError.params);
  return parsed.success ? parsed.data : undefined;
}
