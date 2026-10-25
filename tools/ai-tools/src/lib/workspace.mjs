import { existsSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The root of the Nx workspace: every path a tool reads or writes is inside it. */
export const WORKSPACE_ROOT = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../../..'));

/** Thrown when a path would leave the workspace. */
export class OutsideWorkspaceError extends Error {
  constructor(path) {
    super(`Path is outside the workspace: ${path}`);
    this.name = 'OutsideWorkspaceError';
  }
}

/** Whether `path` (absolute) is the workspace root or inside it. */
function isInside(root, path) {
  const rel = relative(root, path);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

/**
 * The real path of `path`, following symbolic links of every part that exists,
 * so that a link inside the workspace cannot point out of it. Parts that do not
 * exist yet, such as an output folder, are kept as they are.
 */
function realPath(path) {
  let existing = path;
  const rest = [];
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) {
      break;
    }
    rest.unshift(existing.slice(parent.length + 1));
    existing = parent;
  }
  return join(realpathSync(existing), ...rest);
}

/**
 * Resolves a path given to a tool, relative to `base` (the workspace root by
 * default), and returns it as an absolute path. Throws `OutsideWorkspaceError`
 * when the path, or a symbolic link on the way to it, leads out of `root`.
 */
export function resolveInWorkspace(path, { base = WORKSPACE_ROOT, root = WORKSPACE_ROOT } = {}) {
  if (typeof path !== 'string' || path === '' || path.includes('\0')) {
    throw new OutsideWorkspaceError(String(path));
  }
  const absolute = resolve(base, path);
  if (!isInside(root, absolute) || !isInside(root, realPath(absolute))) {
    throw new OutsideWorkspaceError(path);
  }
  return absolute;
}

/** A workspace path for messages, relative to the root and with `/` separators. */
export function workspacePath(absolute) {
  return relative(WORKSPACE_ROOT, absolute).split(sep).join('/');
}
