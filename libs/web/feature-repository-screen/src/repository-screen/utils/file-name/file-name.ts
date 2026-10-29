/** The last name of a working copy path, such as `guide.md` for `docs/guide.md`. */
export function fileName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** The folder of a working copy path, such as `docs` for `docs/guide.md`; `''` for the root folder. */
export function parentPath(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
}

/** The path of `name` in `folder`; the root folder is `''`. */
export function joinPath(folder: string, name: string): string {
  return folder === '' ? name : `${folder}/${name}`;
}

/**
 * Where `path` is after the entry at `from` was renamed to `to`: moved when it
 * is that entry or lies under it, else `null`.
 */
export function movedPath(path: string, from: string, to: string): string | null {
  return path === from || path.startsWith(`${from}/`) ? `${to}${path.slice(from.length)}` : null;
}
