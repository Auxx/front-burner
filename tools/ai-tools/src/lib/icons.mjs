import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { WORKSPACE_ROOT } from './workspace.mjs';

/** The Codicons package (A-10.35). */
export const CODICONS_DIR = join(WORKSPACE_ROOT, 'node_modules/@vscode/codicons');

/** Every Codicon: `{ name, tags, category, description }`, sorted by name. */
export function loadIcons(dir = CODICONS_DIR) {
  const metadata = JSON.parse(readFileSync(join(dir, 'dist/metadata.json'), 'utf8'));
  return Object.entries(metadata)
    .map(([ name, { tags = [], category = '', description = '' } ]) => ({ name, tags, category, description }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The icons that match every word of `query`, best first: a word that is the
 * name or a part of it ranks above a tag, which ranks above the description.
 */
export function findIcons(icons, query) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const score = (icon, word) => {
    const parts = icon.name.split('-');
    if (icon.name === word) {
      return 8;
    }
    if (parts.includes(word)) {
      return 6;
    }
    if (icon.name.includes(word)) {
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
 * The SVG source of an icon and the `d` of its paths. Only names from the
 * metadata are read, so the name can never become a path elsewhere.
 */
export function readIcon(icons, name, dir = CODICONS_DIR) {
  const icon = icons.find(i => i.name === name);
  if (!icon) {
    throw new Error(`Unknown Codicon: ${name}`);
  }
  const file = join(dir, 'src/icons', `${icon.name}.svg`);
  if (!existsSync(file)) {
    throw new Error(`Codicon ${name} has no SVG in the package`);
  }
  const svg = readFileSync(file, 'utf8').trim();
  const paths = [ ...svg.matchAll(/<path[^>]*\sd="([^"]+)"/g) ].map(match => match[1]);
  return { ...icon, svg, paths };
}
