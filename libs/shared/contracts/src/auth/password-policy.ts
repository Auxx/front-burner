import { z } from 'zod';

/** The codes of the password policy's rules, in the order they are reported (PP-10). */
export const PASSWORD_RULES = [
  'too-short',
  'too-long',
  'too-few-classes',
  'control-character',
  'equals-email'
] as const;

export type PasswordRule = (typeof PASSWORD_RULES)[number];

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 256;
const MIN_CLASSES = 2;

// The character classes of REQ-AUTH-002; everything else is "other".
const CLASSES = [ /\p{Ll}/u, /\p{Lu}/u, /\p{Lo}/u, /\p{Nd}/u ];
const CONTROL = /\p{Cc}/u;

function characterClass(character: string): number | undefined {
  if (CONTROL.test(character)) {
    return undefined;
  }
  const index = CLASSES.findIndex(pattern => pattern.test(character));
  return index === -1 ? CLASSES.length : index;
}

/**
 * Every rule of the password policy that `password` fails (PP-1 to PP-8). The
 * password is normalised to NFC and never trimmed; `equals-email` is checked
 * only when `email` is given.
 */
export function passwordPolicyIssues(password: string, email?: string): PasswordRule[] {
  const normalized = password.normalize('NFC');
  const characters = [ ...normalized ];
  const classes = new Set(characters.map(characterClass).filter(index => index !== undefined));
  const failed = new Set<PasswordRule>();

  if (characters.length < PASSWORD_MIN_LENGTH) {
    failed.add('too-short');
  }
  if (characters.length > PASSWORD_MAX_LENGTH) {
    failed.add('too-long');
  }
  if (classes.size < MIN_CLASSES) {
    failed.add('too-few-classes');
  }
  if (characters.some(character => CONTROL.test(character))) {
    failed.add('control-character');
  }
  if (email !== undefined && normalized.toLowerCase() === email.normalize('NFC').toLowerCase()) {
    failed.add('equals-email');
  }
  return PASSWORD_RULES.filter(rule => failed.has(rule));
}

// A fixed message: the password never appears in an error (PP-11).
const MESSAGE = 'The password does not meet the password policy';

/** A password that meets PP-3 to PP-6; one issue per failed rule, its code in `params.code`. */
export const PasswordSchema = z.string().superRefine((password, ctx) => {
  for (const rule of passwordPolicyIssues(password)) {
    ctx.addIssue({ code: 'custom', message: MESSAGE, params: { code: rule } });
  }
});

/** The object-level check of PP-7, reported at `password`. */
export function refinePasswordNotEmail<T extends { email?: string; password: string; }>(
  value: T,
  ctx: z.RefinementCtx<T>
): void {
  if (passwordPolicyIssues(value.password, value.email).includes('equals-email')) {
    ctx.addIssue({ code: 'custom', message: MESSAGE, path: [ 'password' ], params: { code: 'equals-email' } });
  }
}
