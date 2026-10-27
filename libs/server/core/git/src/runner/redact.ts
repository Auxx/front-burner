// `scheme://` followed by user info up to the last `@` before the host: no
// whitespace, quote or `/`, so it never runs past the authority.
const USER_INFO = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/'"<>]*@/gi;

/** Replaces the user info of every `scheme://user[:password]@` in the text with `***@` (NF-10.5). */
export function redactCredentials(text: string): string {
  return text.replace(USER_INFO, '$1***@');
}
