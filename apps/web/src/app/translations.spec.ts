import { ERROR_CODES, PASSWORD_RULES } from '@front-burner/shared-contracts';

import en from '../../public/i18n/en.json';

const texts: Record<string, string> = en;
const AUTH = 'web-feature-auth';

describe('i18n/en.json', () => {
  it.each([ ...ERROR_CODES, 'network' ])('has the text errors.%s', code => {
    expect(texts[`errors.${code}`]).toEqual(expect.any(String));
  });

  it.each([ 'title', 'message' ])('has web-feature-auth.LoginPage.%s', key => {
    expect(texts[`${AUTH}.LoginPage.${key}`]).toEqual(expect.any(String));
  });

  it.each(PASSWORD_RULES)('has the policy rule and the field error for %s', rule => {
    expect(texts[`${AUTH}.PasswordPolicyComponent.rules.${rule}`]).toEqual(expect.any(String));
    expect(texts[`${AUTH}.PasswordSetupStepComponent.fieldErrors.password.${rule}`]).toEqual(expect.any(String));
  });

  it.each([ 0, 1, 2, 3, 4 ])('has the strength text for score %i', score => {
    expect(texts[`${AUTH}.PasswordSetupStepComponent.strengths.${score}`]).toEqual(expect.any(String));
  });
});
