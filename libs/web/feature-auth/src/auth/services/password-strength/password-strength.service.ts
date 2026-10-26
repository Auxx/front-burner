import { inject, Injectable, InjectionToken } from '@angular/core';

export type PasswordStrength = 0 | 1 | 2 | 3 | 4;

/** The part of zxcvbn this service uses. */
export interface StrengthEstimator {
  check(password: string, userInputs: string[]): { score: number; };
}

/** Loads zxcvbn with its dictionaries; replaced in specs. */
export const ZXCVBN_LOADER = new InjectionToken<() => Promise<StrengthEstimator>>('ZXCVBN_LOADER', {
  providedIn: 'root',
  factory: () => loadZxcvbn
});

/**
 * Estimates how hard a password is to guess with zxcvbn (PP-14). The library
 * and its dictionaries load on first use, so they stay out of the initial
 * bundle (NF-2.9). The meter is advisory: when they cannot load, for example
 * offline, the answer is `null` and the next call tries again.
 */
@Injectable({ providedIn: 'root' })
export class PasswordStrengthService {
  private readonly load = inject(ZXCVBN_LOADER);
  private estimator: Promise<StrengthEstimator> | undefined;

  async estimate(password: string, userInputs: string[]): Promise<PasswordStrength | null> {
    this.estimator ??= this.load();
    try {
      return (await this.estimator).check(password, withParts(userInputs)).score as PasswordStrength;
    } catch {
      this.estimator = undefined;
      return null;
    }
  }
}

/** zxcvbn matches whole inputs only, so the parts of an email or a name are added too. */
function withParts(userInputs: string[]): string[] {
  const parts = userInputs.flatMap(input => input.split(/[^\p{L}\p{N}]+/u));
  return [ ...new Set([ ...userInputs, ...parts ].filter(part => part.length >= 3)) ];
}

async function loadZxcvbn(): Promise<StrengthEstimator> {
  const [ { ZxcvbnFactory }, common, en ] = await Promise.all([
    import('@zxcvbn-ts/core'),
    import('@zxcvbn-ts/language-common'),
    import('@zxcvbn-ts/language-en')
  ]);
  return new ZxcvbnFactory({
    translations: en.translations,
    graphs: common.adjacencyGraphs,
    dictionary: { ...common.dictionary, ...en.dictionary }
  });
}
