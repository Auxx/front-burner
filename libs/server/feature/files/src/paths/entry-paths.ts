import { constants } from 'node:fs';

/** Never listed, counted or changed, in any case (FB-5, FB-19). */
export const isGitName = (name: string): boolean => name.toLowerCase() === '.git';

/** Opens a sub-folder through its parent's descriptor without following a link. */
export const SUBFOLDER_FLAGS = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;

/** `[ parent, name ]` of a non-root path; the parent of a top-level entry is `''`. */
export function splitPath(path: string): [ string, string ] {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? [ '', path ] : [ path.slice(0, slash), path.slice(slash + 1) ];
}

/** The path of `name` inside `folder` (`''` is the root). */
export const joinPath = (folder: string, name: string): string => folder === '' ? name : `${folder}/${name}`;
