import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { WORKSPACE_ROOT } from './workspace.mjs';

/** The Codicons package (A-10.35). */
export const CODICONS_DIR = join(WORKSPACE_ROOT, 'node_modules/@vscode/codicons');

/** The icon list of `ui-icon`, kept by hand: `ICON_NAMES` (A-10.35). */
export const UI_ICON_LIST = join(WORKSPACE_ROOT, 'libs/ui/src/content/models/icon-name.model.ts');

/** The sprite that `ui-icon` draws from, built from `UI_ICON_LIST` by `sprite`. */
export const UI_SPRITE = join(WORKSPACE_ROOT, 'libs/ui/src/assets/icons.svg');

/**
 * Every Codicon: `{ name, aliases, tags, category, description }`, sorted by
 * name. `name` is the icon's SVG file in the package, the name `ui-icon`
 * takes; `aliases` are its other names in `mapping.json`. The metadata is
 * keyed by any of them, so it is looked up by all.
 */
export function loadIcons(dir = CODICONS_DIR) {
  const metadata = JSON.parse(readFileSync(join(dir, 'dist/metadata.json'), 'utf8'));
  const mapping = JSON.parse(readFileSync(join(dir, 'src/template/mapping.json'), 'utf8'));
  const aliasesOf = new Map();
  for (const names of Object.values(mapping)) {
    for (const name of names) {
      aliasesOf.set(name, names);
    }
  }
  return readdirSync(join(dir, 'src/icons'))
    .filter(file => file.endsWith('.svg'))
    .map(file => {
      const name = file.slice(0, -'.svg'.length);
      const names = aliasesOf.get(name) ?? [ name ];
      const { tags = [], category = '', description = '' } = names.map(n => metadata[n]).find(Boolean) ?? {};
      return { name, aliases: names.filter(n => n !== name), tags, category, description };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The icons that match every word of `query`, best first: a word that is the
 * name or a part of it ranks above a tag, which ranks above the description.
 */
export function findIcons(icons, query) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const score = (icon, word) => {
    const names = [ icon.name, ...icon.aliases ];
    if (names.includes(word)) {
      return 8;
    }
    if (names.some(name => name.split('-').includes(word))) {
      return 6;
    }
    if (names.some(name => name.includes(word))) {
      return 4;
    }
    if (icon.tags.some(tag => tag.toLowerCase() === word)) {
      return 3;
    }
    if (icon.tags.some(tag => tag.toLowerCase().includes(word))) {
      return 2;
    }
    return icon.description.toLowerCase().includes(word) || icon.category === word ? 1 : 0;
  };
  return icons
    .map(icon => ({ icon, scores: words.map(word => score(icon, word)) }))
    .filter(({ scores }) => scores.every(s => s > 0))
    .sort((a, b) =>
      b.scores.reduce((x, y) => x + y) - a.scores.reduce((x, y) => x + y) || a.icon.name.localeCompare(b.icon.name)
    )
    .map(({ icon }) => icon);
}

/**
 * The SVG source of an icon, found by its name or any alias, and the `d` of its
 * paths. Only names of loaded icons are read, so a name can never become a path
 * elsewhere.
 */
export function readIcon(icons, name, dir = CODICONS_DIR) {
  const icon = icons.find(i => i.name === name || i.aliases.includes(name));
  if (!icon) {
    throw new Error(`Unknown Codicon: ${name}`);
  }
  const svg = readFileSync(join(dir, 'src/icons', `${icon.name}.svg`), 'utf8').trim();
  const paths = [ ...svg.matchAll(/<path[^>]*\sd="([^"]+)"/g) ].map(match => match[1]);
  return { ...icon, svg, paths };
}

/**
 * The names in `ICON_NAMES` of `UI_ICON_LIST`, or of `source` when given.
 * Throws when the list is not an array of quoted names.
 */
export function readIconList(source = readFileSync(UI_ICON_LIST, 'utf8')) {
  const list = /export const ICON_NAMES = \[([^\]]*)\] as const;/.exec(source);
  const items = list?.[1].split(',').map(item => item.trim()).filter(Boolean) ?? [];
  if (!list || !items.length || items.some(item => !/^'[a-z0-9-]+'$/.test(item))) {
    throw new Error(`${UI_ICON_LIST}: ICON_NAMES must be an array of quoted icon names`);
  }
  return items.map(item => item.slice(1, -1));
}

/**
 * A sprite of the named icons, one `<symbol>` per line, with the icon's name as
 * its `id`. Ids inside an icon (clip paths) are prefixed with its name, so that
 * icons cannot clash.
 */
export function buildSprite(icons, names, dir = CODICONS_DIR) {
  const symbols = names.map(name => {
    const icon = icons.find(i => i.name === name);
    if (!icon) {
      throw new Error(`Unknown Codicon: ${name}`);
    }
    const { svg } = readIcon(icons, name, dir);
    const inner = /^<svg[^>]*>([\s\S]*)<\/svg>$/.exec(svg)?.[1];
    if (inner === undefined) {
      throw new Error(`Codicon ${name}: not a single <svg> element`);
    }
    const scoped = inner
      .replace(/\sid="([^"]+)"/g, ` id="${name}--$1"`)
      .replace(/url\(#([^)]+)\)/g, `url(#${name}--$1)`)
      .replace(/href="#([^"]+)"/g, `href="#${name}--$1"`);
    return `<symbol id="${name}" viewBox="0 0 16 16">${scoped}</symbol>`;
  });
  return [
    '<svg xmlns="http://www.w3.org/2000/svg">',
    // No "--" inside a comment: it would make the sprite invalid XML.
    '<!-- Codicons (CC-BY-4.0, https://github.com/microsoft/vscode-codicons). Built by the sprite command of tools/ai-tools/src/bin/icons.mjs from ICON_NAMES in libs/ui/src/content/models/icon-name.model.ts; do not edit. -->',
    ...symbols,
    '</svg>',
    ''
  ].join('\n');
}
