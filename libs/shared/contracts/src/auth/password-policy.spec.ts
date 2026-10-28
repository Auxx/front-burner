import { passwordPolicyIssues, PasswordSchema } from './password-policy';

// One test per acceptance criterion of REQ-AUTH-002 that needs no login.
describe('passwordPolicyIssues', () => {
  it('AC-AUTH-002.1: one class', () => expect(passwordPolicyIssues('abcdefghij')).toEqual([ 'too-few-classes' ]));

  it('AC-AUTH-002.2: two classes', () => expect(passwordPolicyIssues('abcdefghi1')).toEqual([]));

  it('AC-AUTH-002.3: nine characters', () => expect(passwordPolicyIssues('Abcdefgh1')).toEqual([ 'too-short' ]));

  it('AC-AUTH-002.4: Cyrillic and a space', () => expect(passwordPolicyIssues('пароль пароль')).toEqual([]));

  it('AC-AUTH-002.5: caseless letters', () => {
    expect(passwordPolicyIssues('密码密码密码密码密码')).toEqual([ 'too-few-classes' ]);
    expect(passwordPolicyIssues('密码密码密码密码12')).toEqual([]);
  });

  it('AC-AUTH-002.6: 256 and 257 characters', () => {
    const ok = 'a1'.repeat(128);
    expect(passwordPolicyIssues(ok)).toEqual([]);
    expect(passwordPolicyIssues(`${ok}b`)).toEqual([ 'too-long' ]);
  });

  it('AC-AUTH-002.7: tab', () => expect(passwordPolicyIssues('abcde\tfghi1')).toEqual([ 'control-character' ]));

  it('AC-AUTH-002.8: equals the email ignoring case', () =>
    expect(passwordPolicyIssues('alice@example.com', 'Alice@Example.com')).toEqual([ 'equals-email' ]));

  it('AC-AUTH-002.9: every failed rule', () =>
    expect(passwordPolicyIssues('abc')).toEqual([ 'too-short', 'too-few-classes' ]));

  it('AC-AUTH-002.10: NFD counts as NFC', () => expect(passwordPolicyIssues('café crème')).toEqual([]));

  it('AC-AUTH-002.11: is never trimmed', () => expect(passwordPolicyIssues('  abcdefghi1  ')).toEqual([]));

  it('counts code points, not UTF-16 units', () => {
    // Nine emoji are 18 UTF-16 units but 9 characters, plus one digit.
    expect(passwordPolicyIssues('😀'.repeat(9) + '1')).toEqual([]);
    expect(passwordPolicyIssues('😀'.repeat(8) + '1')).toEqual([ 'too-short' ]);
  });
});

describe('PasswordSchema', () => {
  it('reports every failed rule with its code and never the password', () => {
    const result = PasswordSchema.safeParse('abc');
    expect(result.success).toBe(false);
    const issues = result.error?.issues ?? [];
    expect(issues.map(issue => (issue as { params?: { code?: string; }; }).params?.code)).toEqual([
      'too-short',
      'too-few-classes'
    ]);
    for (const issue of issues) {
      expect(JSON.stringify({ ...issue, input: undefined })).not.toContain('abc');
    }
  });

  it('accepts a valid password unchanged', () => {
    expect(PasswordSchema.parse('  abcdefghi1  ')).toBe('  abcdefghi1  ');
  });
});
