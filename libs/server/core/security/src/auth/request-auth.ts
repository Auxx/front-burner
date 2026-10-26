/** Who made a request, as the authentication middleware found it from the auth token (A-1.12). */
export interface RequestAuth {
  userId: number;
  sessionId: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set for a valid auth token of an active session. */
      auth?: RequestAuth;
      /** Why a sent auth token was not accepted; unset when none was sent. */
      authFailure?: 'expired' | 'invalid';
    }
  }
}
