import { inject, Injectable } from '@angular/core';
import { DefaultTranspiler, TRANSLOCO_CONFIG, type TranspileParams } from '@jsverse/transloco';
import { IntlMessageFormat } from 'intl-messageformat';

/**
 * Formats ICU messages (`{count, plural, ...}`, `{kind, select, ...}`, `{name}`) for
 * the active language (NF-14.2). `intl-messageformat` interprets the message, so
 * nothing is compiled with `new Function`, which the CSP and Trusted Types
 * forbid (NF-11.1). Messages with `{{ param }}` keep Transloco's interpolation, and
 * messages without braces are returned as they are. A broken message is logged
 * once and shown as it is, so that the page keeps rendering.
 */
const PLACEHOLDER = /\{\{\s*[\w.]+\s*\}\}/;
const ICU_CONSTRUCT = /\{\s*\w+\s*,\s*(plural|select|selectordinal)\b/;

type Values = Parameters<IntlMessageFormat['format']>[0];

@Injectable()
export class IcuTranspiler extends DefaultTranspiler {
  private lang = inject(TRANSLOCO_CONFIG).defaultLang;
  private readonly formats = new Map<string, IntlMessageFormat | null>();

  onLangChanged(lang: string): void {
    this.lang = lang;
  }

  override transpile(params: TranspileParams): unknown {
    const { value, key, params: values } = params;
    if (typeof value !== 'string' || !value.includes('{')) {
      return super.transpile(params);
    }
    if (PLACEHOLDER.test(value) && !ICU_CONSTRUCT.test(value)) {
      return super.transpile(params);
    }

    const format = this.formatFor(key, value);
    if (!format) {
      return value;
    }
    try {
      return format.format(values as Values);
    } catch {
      this.report(key, value, 'missing or invalid argument');
      return value;
    }
  }

  private formatFor(key: string, value: string): IntlMessageFormat | null {
    const cacheKey = `${this.lang}\u0000${value}`;
    if (!this.formats.has(cacheKey)) {
      try {
        this.formats.set(cacheKey, new IntlMessageFormat(value, this.lang));
      } catch {
        this.formats.set(cacheKey, null);
        this.report(key, value, 'malformed message');
      }
    }
    return this.formats.get(cacheKey) ?? null;
  }

  private readonly reported = new Set<string>();

  /** Logs once per language and message, naming the key and never the values. */
  private report(key: string, value: string, problem: string): void {
    const id = `${this.lang}\u0000${value}`;
    if (!this.reported.has(id)) {
      this.reported.add(id);
      console.error(`Translation "${key}" (${this.lang}): ${problem}; showing the raw message.`);
    }
  }
}
