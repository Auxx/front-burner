import { EgressHttpClient } from '@front-burner/server-core-security';
import type { OidcAvailability } from '@front-burner/shared-contracts';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import * as client from 'openid-client';
import { OidcSettings, OidcSettingsService } from './oidc-settings.service';

/** How long a failed discovery is remembered before the next try (plan's call). */
const RETRY_AFTER_MS = 60_000;
const DISCOVERY_TIMEOUT_S = 10;

interface CachedDiscovery {
  key: string;
  result: Promise<client.Configuration>;
  /** Set once the discovery failed. */
  failedAt?: number;
}

const keyOf = (settings: OidcSettings) => JSON.stringify([ settings.issuer, settings.clientId, settings.clientSecret ]);

/** The OIDC provider's metadata, from discovery (AO-23, AO-32, LG-7), through the egress client (A-7.8). */
@Injectable()
export class OidcProviderService implements OnApplicationBootstrap {
  private readonly logger = new Logger(OidcProviderService.name);
  private cached: CachedDiscovery | undefined;

  constructor(
    private readonly settings: OidcSettingsService,
    private readonly egress: EgressHttpClient
  ) {}

  /** AO-32: a provider that is down does not stop the backend. */
  async onApplicationBootstrap(): Promise<void> {
    if (this.settings.current() === undefined) {
      return;
    }
    try {
      await this.configuration();
      this.logger.log('OIDC provider discovered');
    } catch (error) {
      this.logger.error(`OIDC provider discovery failed: ${reasonOf(error)}`);
    }
  }

  /**
   * The client configuration, cached until the settings change; a failure is
   * remembered for a minute, then discovery is tried again.
   *
   * @throws Error when OIDC is not configured or discovery fails.
   */
  configuration(): Promise<client.Configuration> {
    const settings = this.settings.current();
    if (settings === undefined) {
      return Promise.reject(new Error('OIDC is not configured'));
    }
    const key = keyOf(settings);
    const cached = this.cached;
    if (
      cached?.key === key && (cached.failedAt === undefined || Date.now() - cached.failedAt < RETRY_AFTER_MS)
    ) {
      return cached.result;
    }
    const entry: CachedDiscovery = { key, result: this.discover(settings) };
    entry.result.catch(() => {
      entry.failedAt = Date.now();
    });
    this.cached = entry;
    return entry.result;
  }

  async availability(): Promise<OidcAvailability> {
    if (this.settings.current() === undefined) {
      return 'not-configured';
    }
    try {
      await this.configuration();
      return 'available';
    } catch {
      return 'unavailable';
    }
  }

  private discover(settings: OidcSettings): Promise<client.Configuration> {
    return client.discovery(new URL(settings.issuer), settings.clientId, settings.clientSecret, undefined, {
      [client.customFetch]: (url, options) =>
        this.egress.fetch(url, options as Parameters<EgressHttpClient['fetch']>[1]) as unknown as Promise<Response>,
      timeout: DISCOVERY_TIMEOUT_S
    });
  }
}

/** A short reason for the log: never a secret, as discovery sends none. */
export function reasonOf(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }
  const cause = (error as { cause?: unknown; }).cause;
  return cause instanceof Error ? `${error.message} (${cause.message})` : error.message;
}
