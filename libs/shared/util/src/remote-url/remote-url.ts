/** AR-8. */
export const REMOTE_URL_MAX_LENGTH = 2048;

export type RemoteUrlProblem =
  | 'required'
  | 'too-long'
  | 'unsupported'
  | 'credentials-in-url'
  | 'empty-path'
  | 'query-or-fragment';

/** A remote URL of AR-9, taken apart. */
export interface ParsedRemote {
  protocol: 'https' | 'ssh';
  /** Without the brackets of an IPv6 address. */
  host: string;
  port: number | undefined;
  user: string | undefined;
  /** As written, without the leading `/` of the URL forms. */
  path: string;
}

export type RemoteUrlResult = { ok: true; remote: ParsedRemote; } | { ok: false; problem: RemoteUrlProblem; };

const SCHEME = /^([A-Za-z][A-Za-z0-9+.-]*):\/\//;
// A DNS name (which includes an IPv4 address) of at most 253 characters.
const HOST_NAME =
  /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;
// The user of the scp-like form: anything up to the first `@`, but no `:`, `/` or `\`.
const SCP_USER = /^([^@:/\\]+)@/;
// Backslashes and control characters: parsers disagree on them (WHATWG reads `\` as `/`).
const hasUnsafeCharacter = (text: string): boolean =>
  [ ...text ].some(character => character === '\\' || character <= '\u001f' || character === '\u007f');

const failure = (problem: RemoteUrlProblem): RemoteUrlResult => ({ ok: false, problem });

/** A user that ssh cannot take for an option. */
const isValidUser = (user: string): boolean => !user.startsWith('-');

function isIPv6(host: string): boolean {
  try {
    new URL(`http://[${host}]/`);
    return true;
  } catch {
    return false;
  }
}

function parseUrlForm(input: string, protocol: 'https' | 'ssh'): RemoteUrlResult {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return failure('unsupported');
  }
  if (url.password !== '' || (protocol === 'https' && url.username !== '')) {
    return failure('credentials-in-url');
  }
  if (/[?#]/.test(input)) {
    return failure('query-or-fragment');
  }
  const host = url.hostname.replace(/^\[(.*)\]$/, '$1');
  const bracketed = url.hostname.startsWith('[');
  // Non-special URLs (ssh://) keep any host as written, so it is checked here.
  if ((bracketed ? !isIPv6(host) : !HOST_NAME.test(host)) || !isValidUser(url.username)) {
    return failure('unsupported');
  }
  // The path as written: everything after the authority's first `/`.
  const rest = input.slice(protocol.length + 3);
  const slash = rest.indexOf('/');
  const path = slash < 0 ? '' : rest.slice(slash + 1);
  if (path === '') {
    return failure('empty-path');
  }
  return {
    ok: true,
    remote: {
      protocol,
      host,
      port: url.port === '' ? undefined : Number(url.port),
      user: url.username === '' ? undefined : url.username,
      path
    }
  };
}

/** `[user@]host:path`; anything else is not a remote URL, a local path included (AR-9). */
function parseScpForm(input: string): RemoteUrlResult {
  const userMatch = SCP_USER.exec(input);
  const afterUser = userMatch ? input.slice(userMatch[0].length) : input;
  let host: string;
  let path: string;
  if (afterUser.startsWith('[')) {
    const end = afterUser.indexOf(']');
    host = afterUser.slice(1, end);
    if (end < 0 || afterUser[end + 1] !== ':' || !isIPv6(host)) {
      return failure('unsupported');
    }
    path = afterUser.slice(end + 2);
  } else {
    const colon = afterUser.indexOf(':');
    host = afterUser.slice(0, colon);
    // Without a user, a one-letter host is a Windows drive, as in `C:\repos`.
    if (colon < 0 || (!userMatch && host.length < 2) || !HOST_NAME.test(host)) {
      return failure('unsupported');
    }
    path = afterUser.slice(colon + 1);
  }
  if (userMatch && !isValidUser(userMatch[1] ?? '')) {
    return failure('unsupported');
  }
  if (path === '') {
    return failure('empty-path');
  }
  // `<helper>::<address>` makes git run a remote helper (git-remote-<helper>).
  if (path.startsWith(':')) {
    return failure('unsupported');
  }
  return { ok: true, remote: { protocol: 'ssh', host, port: undefined, user: userMatch?.[1], path } };
}

/** Checks a remote URL against AR-8 to AR-10 and takes it apart. */
export function parseRemoteUrl(input: string): RemoteUrlResult {
  const trimmed = input.trim();
  if (trimmed === '') {
    return failure('required');
  }
  if (trimmed.length > REMOTE_URL_MAX_LENGTH) {
    return failure('too-long');
  }
  if (hasUnsafeCharacter(trimmed)) {
    return failure('unsupported');
  }
  const scheme = SCHEME.exec(trimmed)?.[1]?.toLowerCase();
  if (scheme === 'https' || scheme === 'ssh') {
    return parseUrlForm(trimmed, scheme);
  }
  if (scheme !== undefined) {
    return failure('unsupported');
  }
  return parseScpForm(trimmed);
}

function normalisedPath(remote: ParsedRemote): string {
  return remote.path
    .replace(/^\/+/, '')
    .replace(/^~\//, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/, '');
}

/**
 * `host/path`, with the host in lower case and the path without a leading `/`
 * or `~/` and a trailing `/` or `.git`: the remote's display form (DS-18) and
 * its identity (AR-12), whatever the protocol, user and port.
 */
export function remoteKey(remote: ParsedRemote): string {
  return `${remote.host.toLowerCase()}/${normalisedPath(remote)}`;
}

/**
 * A remote URL as the dashboard shows it (DS-18), never with credentials
 * (DS-19): the {@link remoteKey} or, for a URL that does not parse, the URL
 * without its user name and password.
 */
export function remoteDisplay(url: string): string {
  const withoutCredentials = url.trim().replace(
    /^([A-Za-z][A-Za-z0-9+.-]*:\/\/)([^/?#]*)@/,
    (whole, scheme: string, userInfo: string) =>
      scheme.toLowerCase() === 'https://' || userInfo.includes(':') ? scheme : whole
  );
  const result = parseRemoteUrl(withoutCredentials);
  return result.ok ? remoteKey(result.remote) : withoutCredentials;
}

/** The last segment of the path without `.git` (AR-13). */
export function defaultRepositoryName(remote: ParsedRemote): string {
  return normalisedPath(remote).split('/').pop() ?? '';
}
