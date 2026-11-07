import templateParser from '@angular-eslint/template-parser';
import { RuleTester } from 'eslint';
import { describe, it } from 'vitest';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

/** ESLint's `RuleTester` for rules on Angular templates, reporting through Vitest. */
export const ruleTester = new RuleTester({ languageOptions: { parser: templateParser } });
