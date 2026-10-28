/** The last name of a working copy path, such as `guide.md` for `docs/guide.md`. */
export function fileName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}
