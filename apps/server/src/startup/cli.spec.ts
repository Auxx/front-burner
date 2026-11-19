import { parseCommand } from './cli';

const argv = (...args: string[]) => [ 'node', 'main.js', ...args ];

describe('parseCommand', () => {
  it('serves without arguments', () => {
    expect(parseCommand(argv())).toEqual({ kind: 'serve' });
  });

  it('returns the file after --write-openapi', () => {
    expect(parseCommand(argv('--write-openapi', 'out.json'))).toEqual({ kind: 'write-openapi', file: 'out.json' });
  });

  it('refuses --write-openapi without a file', () => {
    expect(() => parseCommand(argv('--write-openapi'))).toThrow('--write-openapi needs a file');
  });

  it('refuses another flag in place of the file', () => {
    expect(() => parseCommand(argv('--write-openapi', '--x'))).toThrow('--write-openapi needs a file');
  });

  it('parses reset-password with an email', () => {
    expect(parseCommand(argv('reset-password', 'admin@example.com'))).toEqual({
      kind: 'reset-password',
      email: 'admin@example.com'
    });
  });

  it('refuses reset-password without an email', () => {
    expect(() => parseCommand(argv('reset-password'))).toThrow('reset-password needs the user\'s email');
  });

  it('refuses a password after the email, so that none is typed into the arguments', () => {
    expect(() => parseCommand(argv('reset-password', 'admin@example.com', 'secret'))).toThrow(
      'reset-password takes only the user\'s email'
    );
  });

  it('shows the help, also for reset-password', () => {
    expect(parseCommand(argv('--help'))).toEqual({ kind: 'help' });
    expect(parseCommand(argv('reset-password', '--help'))).toEqual({ kind: 'help' });
  });

  it('refuses an unknown argument', () => {
    expect(() => parseCommand(argv('reset-pasword', 'admin@example.com'))).toThrow('Unknown argument reset-pasword');
  });
});
