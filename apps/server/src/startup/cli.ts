const OPENAPI_FLAG = '--write-openapi';
const HELP_FLAG = '--help';
const RESET_PASSWORD = 'reset-password';

/** What `node main.js` was asked to do. */
export type Command =
  | { kind: 'serve'; }
  | { kind: 'write-openapi'; file: string; }
  | { kind: 'reset-password'; email: string; }
  | { kind: 'help'; };

/** The text of `--help`. */
export const USAGE = `Usage:
  node main.js                          Start the instance.
  node main.js reset-password <email>   Set a new password for a password user and revoke
                                        every session of theirs. Stop the instance first: the
                                        command must not run while it is running. The new
                                        password is read from standard input, twice.
  node main.js --write-openapi <file>   Write the API's OpenAPI document and exit.
  node main.js --help                   Show this help.
`;

/**
 * Parses the process arguments (`process.argv`).
 *
 * @throws Error with a one-line reason for arguments that make no command.
 */
export function parseCommand(argv: string[]): Command {
  const args = argv.slice(2);
  if (args.includes(HELP_FLAG)) {
    return { kind: 'help' };
  }
  if (args[0] === RESET_PASSWORD) {
    const email = args[1];
    if (email === undefined || email.startsWith('--')) {
      throw new Error(`${RESET_PASSWORD} needs the user's email`);
    }
    if (args.length > 2) {
      throw new Error(`${RESET_PASSWORD} takes only the user's email; the password is read from standard input`);
    }
    return { kind: 'reset-password', email };
  }
  const flag = args.indexOf(OPENAPI_FLAG);
  if (flag >= 0) {
    const file = args[flag + 1];
    if (file === undefined || file.startsWith('--')) {
      throw new Error(`${OPENAPI_FLAG} needs a file to write the document to`);
    }
    return { kind: 'write-openapi', file };
  }
  if (args.length > 0) {
    throw new Error(`Unknown argument ${args[0]}; see --help`);
  }
  return { kind: 'serve' };
}
