import { inject, Injectable } from '@angular/core';
import { DefaultTranspiler, TRANSLOCO_CONFIG, type TranspileParams } from '@jsverse/transloco';
import { IntlMessageFormat } from 'intl-messageformat';

/**
 * Formats ICU messages (`{count, plural, ...}`, `{kind, select, ...}`, `{name}`) for
 * the active language (NF-14.2). `intl-messageformat` interprets the message, so
 * nothing is compiled with `new Function`, which the CSP and Trusted Types
 * forbid (NF-11.1). Messages with `{{ param }}` keep Transloco's interpolation, and
 * messages without braces are returned as they are.
 */
@Injectable()
export class IcuTranspiler extends DefaultTranspiler {
  private lang = inject(TRANSLOCO_CONFIG).defaultLang;
  private readonly formats = new Map<string, IntlMessageFormat>();

  onLangChanged(lang: string): void {
    this.lang = lang;
  }

  override transpile(params: TranspileParams): unknown {
    const { value, params: values } = params;
    if (typeof value !== 'string' || !value.includes('{') || value.includes('{{')) {
      return super.transpile(params);
    }

    const cacheKey = `${this.lang}\u0000${value}`;
    let format = this.formats.get(cacheKey);
    if (!format) {
      format = new IntlMessageFormat(value, this.lang);
      this.formats.set(cacheKey, format);
    }
    return format.format(values as Record<string, string | number | boolean | Date | null | undefined>);
  }
}
