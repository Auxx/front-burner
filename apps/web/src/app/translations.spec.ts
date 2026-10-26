import { ERROR_CODES, PASSWORD_RULES } from '@front-burner/shared-contracts';

import en from '../../public/i18n/en.json';

const texts: Record<string, string> = en;
const AUTH = 'web-feature-auth';

describe('i18n/en.json', () => {
  it.each([ ...ERROR_CODES, 'network' ])('has the text errors.%s', code => {
    expect(texts[`errors.${code}`]).toEqual(expect.any(String));
  });

  it.each([ 'logged-out', 'session-expired', 'password-reset' ])('has the login message %s', message => {
    expect(texts[`${AUTH}.LoginPage.messages.${message}`]).toEqual(expect.any(String));
  });

  it.each([
    [ 'errors.wrong-credentials', 'Wrong username or password' ],
    [ `${AUTH}.LoginPage.title`, 'Log in' ],
    [ `${AUTH}.LoginPage.messages.logged-out`, 'You have been logged out' ],
    [ `${AUTH}.LoginPage.messages.session-expired`, 'Your session has expired. Please log in again' ],
    [
      `${AUTH}.LoginPage.insecure`,
      'This instance is not served over HTTPS. You will be logged out when your session token expires.'
    ],
    [ `${AUTH}.LoginPage.insecureHowTo`, 'How to set up HTTPS' ]
  ])('has the fixed text %s', (key, text) => {
    expect(texts[key]).toBe(text);
  });

  it.each(PASSWORD_RULES)('has the policy rule and the field error for %s', rule => {
    expect(texts[`${AUTH}.PasswordPolicyComponent.rules.${rule}`]).toEqual(expect.any(String));
    expect(texts[`${AUTH}.PasswordSetupStepComponent.fieldErrors.password.${rule}`]).toEqual(expect.any(String));
  });

  it.each([ 0, 1, 2, 3, 4 ])('has the strength text for score %i', score => {
    expect(texts[`${AUTH}.PasswordSetupStepComponent.strengths.${score}`]).toEqual(expect.any(String));
  });
});
