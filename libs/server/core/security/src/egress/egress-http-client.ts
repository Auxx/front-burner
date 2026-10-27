import { CONFIG, Config } from '@front-burner/server-core-config';
import { Inject, Injectable, OnModuleDestroy, Optional } from '@nestjs/common';
import type { LookupAddress, LookupOptions } from 'node:dns';
import { isIP } from 'node:net';
import { Agent, buildConnector, fetch, RequestInit, Response } from 'undici';
import { EgressRefusedError, resolveAllowed } from './address-policy';

/** Injection token for {@link EgressHttpOptions}. */
export const EGRESS_HTTP_OPTIONS = 'FRONT_BURNER_EGRESS_HTTP_OPTIONS';

/** Production trusts the system's certificate authorities and `NODE_EXTRA_CA_CERTS`; tests provide their own. */
export interface EgressHttpOptions {
  ca?: string;
}

const DEFAULT_TIMEOUT_MS = 10_000;

type LookupCallback = (error: Error | null, address: string | LookupAddress[], family?: number) => void;

/** The first {@link EgressRefusedError} in an error's `cause` chain. */
function refusalIn(error: unknown): EgressRefusedError | undefined {
  for (let current = error; current instanceof Error; current = (current as { cause?: unknown; }).cause) {
    if (current instanceof EgressRefusedError) {
      return current;
    }
  }
  return undefined;
}

/**
 * The one HTTP client for every outbound request that is not git (A-7.8):
 * HTTPS only, and every connection, redirects included, goes only to
 * addresses that AR-57's rules allow.
 */
@Injectable()
export class EgressHttpClient implements OnModuleDestroy {
  readonly #agent: Agent;

  constructor(
    @Inject(CONFIG) config: Pick<Config, 'blockPrivateNetworks'>,
    @Optional() @Inject(EGRESS_HTTP_OPTIONS) options: EgressHttpOptions | null = null
  ) {
    const policy = { blockPrivateNetworks: config.blockPrivateNetworks };
    // Names are checked by the lookup, which hands the socket only the checked addresses.
    const lookup = (hostname: string, lookupOptions: LookupOptions, callback: LookupCallback) => {
      resolveAllowed(hostname, policy).then(
        addresses => {
          if (lookupOptions.all) {
            callback(null, addresses);
          } else {
            const [ first ] = addresses as [ LookupAddress ];
            callback(null, first.address, first.family);
          }
        },
        (error: unknown) => callback(error as Error, [])
      );
    };
    const connect = buildConnector({ lookup, ...(options?.ca === undefined ? {} : { ca: options.ca }) });
    this.#agent = new Agent({
      connect: (connectOptions, callback) => {
        const host = connectOptions.hostname.replace(/^\[(.*)\]$/, '$1');
        if (connectOptions.protocol !== 'https:') {
          callback(new EgressRefusedError('blocked', host), null);
          return;
        }
        if (isIP(host) === 0) {
          connect(connectOptions, callback);
          return;
        }
        // An IP address never reaches the lookup, so it is checked here.
        resolveAllowed(host, policy).then(
          () => connect(connectOptions, callback),
          (error: unknown) => callback(error as Error, null)
        );
      }
    });
  }

  /**
   * Fetches over HTTPS, following redirects, and aborts after `timeoutMs`
   * (10 seconds by default).
   *
   * @throws EgressRefusedError when the URL or a redirect is not allowed, whatever error the fetch wraps it in.
   */
  async fetch(url: string | URL, init: RequestInit & { timeoutMs?: number; } = {}): Promise<Response> {
    const { timeoutMs = DEFAULT_TIMEOUT_MS, ...rest } = init;
    const target = new URL(url);
    if (target.protocol !== 'https:') {
      throw new EgressRefusedError('blocked', target.hostname);
    }
    const timeout = AbortSignal.timeout(timeoutMs);
    try {
      return await fetch(target, {
        ...rest,
        dispatcher: this.#agent,
        signal: rest.signal ? AbortSignal.any([ rest.signal, timeout ]) : timeout
      });
    } catch (error) {
      throw refusalIn(error) ?? error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    // Closing the application twice must not fail.
    if (!this.#agent.closed && !this.#agent.destroyed) {
      await this.#agent.close();
    }
  }
}
