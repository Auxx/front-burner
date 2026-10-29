/** The last name of a working copy path, such as `guide.md` for `docs/guide.md`. */
export function fileName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** The folder of a working copy path, such as `docs` for `docs/guide.md`; `''` for the root folder. */
export function parentPath(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
}
