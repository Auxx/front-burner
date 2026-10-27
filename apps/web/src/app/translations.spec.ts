import { ERROR_CODES, PASSWORD_RULES } from '@front-burner/shared-contracts';

import en from '../../public/i18n/en.json';

const texts: Record<string, string> = en;
const AUTH = 'web-feature-auth';
const REPOS = 'web-feature-repositories';

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
    [ `${AUTH}.LoginPage.insecureHowTo`, 'How to set up HTTPS' ],
    [ 'web-shell.ShellLayoutComponent.skipToContent', 'Skip to content' ],
    [ 'web-shell.UserMenuComponent.label', 'Account menu for {{ name }}' ],
    [ 'web-shell.UserMenuComponent.logout', 'Log out' ],
    [ 'web-shell.PageNotFoundPage.title', 'Page not found' ],
    [ 'web-feature-dashboard.DashboardPage.title', 'Dashboard' ],
    [ 'web-shell.PageNotFoundPage.heading', 'This page doesn\'t exist.' ],
    [ `${REPOS}.AddRepositoryPage.title`, 'Add repository' ],
    [ `${REPOS}.errors.remoteUrl.unsupported`, 'Use an HTTPS or SSH URL' ],
    [
      `${REPOS}.errors.remoteUrl.credentials-in-url`,
      'Don\'t put credentials in the URL. Use the credentials fields below.'
    ],
    [ `${REPOS}.CredentialsSectionComponent.enterUrlFirst`, 'Enter the remote URL first' ],
    [ `${REPOS}.RemoteSectionComponent.duplicate`, 'You already have this remote as {{ names }}.' ],
    [ `${REPOS}.errors.name.name-taken`, 'You already have a repository named {{ name }}' ],
    [
      `${REPOS}.HttpsCredentialsComponent.noneHint`,
      'For repositories anyone can read. You will need credentials to push changes.'
    ],
    [ `${REPOS}.SshCredentialsComponent.unlocked`, 'Unlocked for this session' ],
    [
      `${REPOS}.GeneratedKeyComponent.instructions`,
      'Add this key to your git server, for example as a deploy key on GitHub or an access key on Bitbucket. '
      + 'Give it write access if you want to push changes.'
    ],
    [ `${REPOS}.GeneratedKeyComponent.keyAdded`, 'I have added this key to my git server' ],
    [ `${REPOS}.CloneSectionComponent.modes.full`, 'Full clone' ],
    [ `${REPOS}.CloneSectionComponent.descriptions.full`, 'All branches and history' ],
    [ `${REPOS}.CloneSectionComponent.modes.single-branch`, 'Single branch' ],
    [
      `${REPOS}.CloneSectionComponent.descriptions.single-branch`,
      'One branch, latest commit only. Faster, but limits the git workflow.'
    ],
    [
      `${REPOS}.CloneSectionComponent.warning`,
      'A single-branch clone contains only the chosen branch and its latest commit. Other branches and older '
      + 'history won\'t be available, and some git operations will be limited.'
    ],
    [ `${REPOS}.CloneSectionComponent.understood`, 'I understand' ],
    [ `${REPOS}.errors.remoteUrl.host-unreachable`, 'Can\'t reach {{ host }}. Check the URL.' ],
    [ `${REPOS}.errors.form.remote-timeout`, '{{ host }} didn\'t answer in time. Try again later.' ],
    [ `${REPOS}.errors.remoteUrl.tls-untrusted`, 'The server\'s certificate isn\'t trusted.' ],
    [ `${REPOS}.errors.credentials.credentials-refused`, 'These credentials can\'t access the repository.' ],
    [
      `${REPOS}.errors.credentials.credentials-refused-generated`,
      'These credentials can\'t access the repository. Has the key been added to your git server?'
    ],
    [ `${REPOS}.errors.credentials.credentials-required`, 'This repository needs credentials.' ],
    [
      `${REPOS}.errors.remoteUrl.repository-not-found`,
      'Repository not found, or these credentials can\'t see it.'
    ],
    [ `${REPOS}.errors.credentials.passphrase.wrong-passphrase`, 'Wrong passphrase.' ],
    [
      `${REPOS}.errors.remoteUrl.host-key-changed`,
      'The server\'s identity has changed. This may be an attack.'
    ],
    [ `${REPOS}.errors.branch.branch-not-found`, 'This branch no longer exists on the remote.' ],
    [ `${REPOS}.errors.branch.no-branches`, 'This repository has no branches' ],
    [ `${REPOS}.CloneSectionComponent.noBranches`, 'This repository has no branches' ],
    [ `${REPOS}.errors.form.remote-failed`, 'Something went wrong while contacting the remote.' ],
    [ `${REPOS}.errors.form.rate-limited`, 'Too many attempts. Try again in a minute.' ]
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
