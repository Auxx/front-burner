import type { EgressOptions } from '@front-burner/server-core-security';

export const GIT_OPTIONS = 'FRONT_BURNER_GIT_OPTIONS';

export interface GitOptions {
  /** The folder of `askpass.cjs` and `proxy-connect.cjs`, shipped with the server (A-5.4). */
  helpersDir: string;
  egress: EgressOptions;
  /** `FRONT_BURNER_CLONE_TIMEOUT` (AR-51). */
  cloneTimeoutMs: number;
  /** `FRONT_BURNER_GIT_TIMEOUT` (NF-11.8). */
  gitTimeoutMs: number;
}
