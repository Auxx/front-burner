# REQ-AUTH-002: Password policy

> Status: **Accepted**

## Summary

Every password that a password user sets must meet the Front Burner password
policy. The policy is the same on every instance, and administrators cannot
change it.

## Scope

The policy applies whenever a password is set, including:

- creating the first administrator during administrator onboarding
  ([REQ-AUTH-001](auth-onboarding.md));
- setting a password during onboarding after an invitation;
- changing or resetting a password.

The policy is **not** applied at login. A password that was valid when it was
set keeps working even if the policy becomes stricter later. Normalization
(PP-1) and hashing (PP-12) apply at login as well, so that a password is
compared in the same form in which it was stored.

The policy does not apply to OIDC users, whose passwords are managed by the
OIDC provider, or to repository credentials.

## Character classes

A character belongs to exactly one of these classes:

| Class           | Characters                                                                       |
|-----------------|----------------------------------------------------------------------------------|
| Lowercase       | Lowercase letters (Unicode category `Ll`), for example `a`–`z`.                  |
| Uppercase       | Uppercase letters (Unicode category `Lu`), for example `A`–`Z`.                  |
| Letter, no case | Letters that have no case (Unicode category `Lo`), for example `密`, `ש` or `ك`. |
| Digit           | Decimal digits (Unicode category `Nd`), for example `0`–`9`.                     |
| Other           | Every other character, including symbols and spaces.                             |

Control characters (Unicode category `Cc`) are not allowed at all (PP-6).

## Requirements

### Normalization

- **PP-1** Before the policy is checked and before the password is hashed,
  the backend normalizes the password to Unicode **NFC**. All rules below are
  checked against the normalized password. Login normalizes the password the
  same way before comparing it, so the same password typed on different
  devices or keyboards always matches.
- **PP-2** The password is never trimmed. Leading and trailing spaces, and
  any other characters, are part of the password, both when it is set and at
  login.

### Rules

- **PP-3** A password must be at least **10 characters** long.
- **PP-4** A password must be at most **256 characters** long.
- **PP-5** A password must contain characters from at least **two** of the
  character classes above.
- **PP-6** A password must not contain control characters (Unicode category
  `Cc`), such as tab, newline or null.
- **PP-7** A password must not be equal to the user's email address. The
  comparison ignores letter case.
- **PP-8** Length is counted in Unicode code points of the normalized
  password, not in bytes.

### Enforcement and errors

- **PP-9** The backend enforces the policy. A password that does not meet it
  is refused, and nothing is changed.
- **PP-10** When a password is refused, the error lists **every** rule that
  failed, not only the first one. Each failed rule has a machine-readable
  code, so that every client can show its own message:

| Rule | Code                |
|------|---------------------|
| PP-3 | `too-short`         |
| PP-4 | `too-long`          |
| PP-5 | `too-few-classes`   |
| PP-6 | `control-character` |
| PP-7 | `equals-email`      |

- **PP-11** The error never contains the password, in whole or in part.

### Storage

- **PP-12** Passwords are hashed with **Argon2**, using the Argon2id variant,
  with a unique random salt for every password. Passwords are never stored in
  any other form.

### Web client

- **PP-13** Every form where a password is set shows the policy before the
  user submits, and checks it as the user types. These client-side checks
  only help the user; the backend check in PP-9 is the one that counts.
- **PP-14** Every form where a password is set shows a password strength
  meter that estimates how hard the password is to guess and updates as the
  user types. The meter is advisory only: it does not block a password that
  meets the policy, and it does not allow one that does not.

### Implementation

- **PP-15** The policy is defined in one place in the codebase and shared by
  the backend and the web client, so the two cannot disagree.

## Acceptance criteria

1. `abcdefghij` (10 characters, one class) is refused with
   `too-few-classes` only.
2. `abcdefghi1` (10 characters, two classes) is accepted.
3. `Abcdefgh1` (9 characters, three classes) is refused with `too-short`.
4. `пароль пароль` (13 characters, lowercase and other) is accepted.
5. `密码密码密码密码密码` (10 characters, letters with no case only) is
   refused with `too-few-classes`. `密码密码密码密码12` (10 characters, letters
   with no case and digits) is accepted.
6. A password of 256 characters that meets every other rule is accepted. The
   same password with one more character is refused with `too-long`.
7. A password containing a tab character is refused with
   `control-character`.
8. For a user with the email `Alice@Example.com`, the password
   `alice@example.com` is refused with `equals-email`.
9. `abc` is refused with both `too-short` and `too-few-classes` in the same
   error.
10. `café crème` sent in NFD form (12 code points, `e` + combining accent) is
    accepted as 10 characters. The user can then log in with the same
    password sent in NFC form, and the other way round.
11. `  abcdefghi1  ` (with leading and trailing spaces) is accepted. Logging
    in with `abcdefghi1` (without the spaces) fails.
12. A stored password hash is an Argon2id hash.
13. Every form where a password is set shows the policy and a strength meter
    that updates as the user types.
14. A user whose stored password does not meet the policy (for example, one
    set up directly in the database for the test) can still log in with it.

## Out of scope

These are not planned:

- checking passwords against lists of breached or common passwords;
- password expiry;
- password history (refusing passwords the user has used before).

## Open questions

None at the moment.
