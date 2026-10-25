import { Injectable } from '@angular/core';
import type { ZxcvbnFactory } from '@zxcvbn-ts/core';

export type PasswordStrength = 0 | 1 | 2 | 3 | 4;

/**
 * Estimates how hard a password is to guess with zxcvbn (PP-14). The library
 * and its dictionaries load on first use, so they stay out of the initial
 * bundle (NF-2.9).
 */
@Injectable({ providedIn: 'root' })
export class PasswordStrengthService {
  private estimator: Promise<ZxcvbnFactory> | undefined;

  async estimate(password: string, userInputs: string[]): Promise<PasswordStrength> {
    this.estimator ??= load();
    return (await this.estimator).check(password, withParts(userInputs)).score as PasswordStrength;
  }
}

/** zxcvbn matches whole inputs only, so the parts of an email or a name are added too. */
function withParts(userInputs: string[]): string[] {
  const parts = userInputs.flatMap(input => input.split(/[^\p{L}\p{N}]+/u));
  return [ ...new Set([ ...userInputs, ...parts ].filter(part => part.length >= 3)) ];
}

async function load(): Promise<ZxcvbnFactory> {
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
