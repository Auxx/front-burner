/**
 * A colour token drawn on a background that must meet a minimum contrast ratio
 * in both colour schemes (A-10.10). Token names are given without `--ui-`.
 */
export interface ContrastPair {
  readonly foreground: string;
  /** Background layers from the bottom up; overlays such as hover go on top. */
  readonly background: readonly string[];
  /** 4.5 for text (WCAG 1.4.3), 3 for borders, icons and focus (WCAG 1.4.11). */
  readonly minimum: 4.5 | 3;
}

const surfaces = [ 'surface-canvas', 'surface-island', 'surface-raised', 'surface-sunken' ];
const statuses = [ 'info', 'success', 'warning', 'danger' ];
const gitStatuses = [ 'added', 'modified', 'deleted', 'renamed', 'untracked', 'conflicted', 'ignored' ];
const diffBackgrounds = [
  'diff-inserted-line',
  'diff-inserted-word',
  'diff-deleted-line',
  'diff-deleted-word',
  'conflict-mine',
  'conflict-theirs',
  'conflict-base',
  'conflict-marker'
];
const syntax = [
  'heading',
  'strong',
  'emphasis',
  'link',
  'url',
  'code',
  'quote',
  'list-marker',
  'html-tag',
  'html-attribute',
  'meta',
  'keyword',
  'string',
  'number',
  'function',
  'type',
  'comment',
  'punctuation'
];

const text = (foreground: string, ...background: string[]): ContrastPair => ({ foreground, background, minimum: 4.5 });
const graphic = (foreground: string, ...background: string[]): ContrastPair => ({ foreground, background, minimum: 3 });

export const CONTRAST_PAIRS: readonly ContrastPair[] = [
  // Text on every surface
  ...[ 'text-default', 'text-muted', 'text-subtle', 'text-link' ].flatMap(fg => surfaces.map(bg => text(fg, bg))),

  // Text on hovered, pressed and selected rows
  ...[ 'text-default', 'text-muted', 'text-link' ].flatMap(fg => [
    text(fg, 'surface-island', 'surface-hover'),
    text(fg, 'surface-island', 'surface-pressed'),
    text(fg, 'selected-active'),
    text(fg, 'selected-inactive')
  ]),
  // Text in menus, also on the hovered or active item; disabled text is
  // exempt (WCAG 1.4.3)
  text('text-default', 'surface-raised', 'surface-hover'),
  text('text-muted', 'surface-raised', 'surface-hover'),
  text('text-inverse', 'text-default'),
  ...[ 'accent', 'accent-hover', 'accent-pressed' ].map(bg => text('text-on-accent', bg)),

  // Control borders, focus ring and accent
  ...[ 'surface-island', 'surface-sunken', 'surface-canvas' ].map(bg => graphic('border-strong', bg)),
  ...[ 'surface-canvas', 'surface-island', 'surface-raised', 'selected-active' ].map(bg => graphic('border-focus', bg)),
  ...[ 'surface-canvas', 'surface-island' ].map(bg => graphic('accent', bg)),

  // Icons on the canvas, such as the activity bar's, also when hovered
  ...[ 'icon-default', 'icon-muted' ].flatMap(fg => [
    graphic(fg, 'surface-canvas'),
    graphic(fg, 'surface-canvas', 'surface-hover')
  ]),

  // Status
  ...statuses.flatMap(status => [
    text(`${status}-text`, `${status}-background`),
    text(`${status}-text`, 'surface-island'),
    graphic(`${status}-icon`, `${status}-background`),
    graphic(`${status}-icon`, 'surface-island')
  ]),

  // Git status in the file tree, also on selected rows
  ...gitStatuses.flatMap(status =>
    [ 'surface-island', 'selected-active', 'selected-inactive' ].map(bg => text(`git-${status}`, bg))
  ),

  // Diffs and conflicts
  ...diffBackgrounds.map(bg => text('text-default', bg)),

  // Editor
  text('editor-line-number', 'editor-background'),
  graphic('editor-cursor', 'editor-background'),
  ...syntax.flatMap(token => [
    text(`syntax-${token}`, 'editor-background'),
    text(`syntax-${token}`, 'editor-background', 'editor-active-line'),
    text(`syntax-${token}`, 'editor-background', 'editor-selection')
  ]),
  text('text-default', 'editor-background', 'editor-match')
];
