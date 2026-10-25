/**
 * The Codicons (CC-BY-4.0) that `ui-icon` can draw: the symbols of its sprite,
 * `libs/ui/src/assets/icons.svg` (A-10.35). To add an icon, add its name here,
 * in order, and rebuild the sprite with `node tools/ai-tools/src/bin/icons.mjs
 * sprite --write`. Find names with `icons.mjs find <word>`.
 */
export const ICON_NAMES = [
  'check',
  'chevron-down',
  'chevron-right',
  'close',
  'ellipsis',
  'error',
  'info',
  'pass',
  'repo',
  'warning'
] as const;

export type IconName = (typeof ICON_NAMES)[number];
