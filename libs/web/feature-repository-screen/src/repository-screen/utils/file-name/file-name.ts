/** The last name of a working copy path, such as `guide.md` for `docs/guide.md`. */
export function fileName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** The folder of a working copy path, such as `docs` for `docs/guide.md`; `''` for the root folder. */
export function parentPath(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
}

/** The folders that lead to `path`, from the root: `''`, `docs` and `docs/api` for `docs/api/index.md`. */
export function ancestors(path: string): string[] {
  const parts = path.split('/').slice(0, -1);
  return [ '', ...parts.map((_, index) => parts.slice(0, index + 1).join('/')) ];
}

/** The path of `name` in `folder`; the root folder is `''`. */
export function joinPath(folder: string, name: string): string {
  return folder === '' ? name : `${folder}/${name}`;
}

/** Whether `path` is the entry at `entry` or lies under it. */
export function isWithin(path: string, entry: string): boolean {
  return path === entry || path.startsWith(`${entry}/`);
}

/**
 * Where `path` is after the entry at `from` was renamed to `to`: moved when it
 * is that entry or lies under it, else `null`.
 */
export function movedPath(path: string, from: string, to: string): string | null {
  return isWithin(path, from) ? `${to}${path.slice(from.length)}` : null;
}
