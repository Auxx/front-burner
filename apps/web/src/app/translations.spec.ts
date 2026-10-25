import { ERROR_CODES } from '@front-burner/shared-contracts';

import en from '../../public/i18n/en.json';

const texts: Record<string, string> = en;

describe('i18n/en.json', () => {
  it.each([ ...ERROR_CODES, 'network' ])('has the text errors.%s', code => {
    expect(texts[`errors.${code}`]).toEqual(expect.any(String));
  });

  it.each([ 'title', 'message' ])('has web-feature-auth.LoginPage.%s', key => {
    expect(texts[`web-feature-auth.LoginPage.${key}`]).toEqual(expect.any(String));
  });
});
