/**
 * The Codicons (CC-BY-4.0) that `ui-icon` can draw: the symbols of its sprite,
 * `libs/ui/src/assets/icons.svg` (A-10.35). To add an icon, add its name here,
 * in order, and rebuild the sprite with `node tools/ai-tools/src/bin/icons.mjs
 * sprite --write`. Find names with `icons.mjs find <word>`.
 */
export const ICON_NAMES = [
  'arrow-down',
  'arrow-up',
  'case-sensitive',
  'check',
  'chevron-down',
  'chevron-right',
  'close',
  'diff-ignored',
  'ellipsis',
  'error',
  'eye',
  'file',
  'file-submodule',
  'file-symlink-file',
  'files',
  'flame',
  'folder',
  'home',
  'info',
  'lock',
  'markdown',
  'menu',
  'new-file',
  'new-folder',
  'pass',
  'regex',
  'replace',
  'replace-all',
  'repo',
  'repo-fetch',
  'repo-pull',
  'repo-push',
  'source-control',
  'sync',
  'warning',
  'whole-word',
  'word-wrap'
] as const;

export type IconName = (typeof ICON_NAMES)[number];
