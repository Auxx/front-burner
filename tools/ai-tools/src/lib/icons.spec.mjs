import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildSprite, findIcons, loadIcons, readIcon, readIconList, UI_ICON_LIST, UI_SPRITE } from './icons.mjs';
import { readText, WORKSPACE_ROOT } from './workspace.mjs';

describe('icons', () => {
  const icons = loadIcons();

  it('loads the Codicons metadata', () => {
    expect(icons.length).toBeGreaterThan(400);
    expect(icons.find(icon => icon.name === 'close')).toMatchObject({ category: 'action' });
  });

  it('ranks an exact name first, then names, tags and descriptions', () => {
    const names = findIcons(icons, 'close').map(icon => icon.name);
    expect(names[0]).toBe('close');
    expect(names).toContain('close-all');
  });

  it('needs every word to match', () => {
    expect(findIcons(icons, 'git pull request').map(icon => icon.name)).toContain('git-pull-request');
    expect(findIcons(icons, 'close zzzz')).toEqual([]);
  });

  it('reads the SVG and its paths', () => {
    const eye = readIcon(icons, 'eye');
    expect(eye.svg).toMatch(/^<svg[^>]+viewBox="0 0 16 16"/);
    expect(eye.paths.length).toBeGreaterThan(0);
  });

  it('reads only icons from the metadata, so a name cannot become a path', () => {
    expect(() => readIcon(icons, '../../package')).toThrow('Unknown Codicon');
    expect(() => readIcon(icons, 'nope')).toThrow('Unknown Codicon');
  });

  it('names each icon by its source file and finds it by any alias', () => {
    expect(icons.find(icon => icon.name === 'warning')).toMatchObject({ aliases: [ 'alert' ] });
    expect(findIcons(icons, 'alert')[0].name).toBe('warning');
    expect(findIcons(icons, 'ellipsis')[0].name).toBe('ellipsis');
    expect(readIcon(icons, 'alert').name).toBe('warning');
  });

  it('builds a sprite of the listed icons', () => {
    const sprite = buildSprite(icons, [ 'close', 'warning' ]);
    expect(sprite).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg">/);
    expect(sprite).toContain('<symbol id="close" viewBox="0 0 16 16"><path');
    expect(sprite).toContain('<symbol id="warning" viewBox="0 0 16 16"><path d="M14.831');
    expect(sprite).not.toContain('width=');
    expect(() => buildSprite(icons, [ 'close', 'nope' ])).toThrow('Unknown Codicon: nope');
  });

  it('prefixes the ids inside an icon with its name, and the references to them', () => {
    mkdirSync(join(WORKSPACE_ROOT, 'tmp'), { recursive: true });
    const fixture = mkdtempSync(join(WORKSPACE_ROOT, 'tmp', 'ai-tools-icons-'));
    try {
      mkdirSync(join(fixture, 'src/icons'), { recursive: true });
      writeFileSync(
        join(fixture, 'src/icons/clipped.svg'),
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><defs><clipPath id="a"><path d="M0 0h16v16H0z"/></clipPath>'
          + '<path id="b" d="M1 1h14v14H1z"/></defs><g clip-path="url(#a)"><use href="#b"/></g></svg>'
      );
      const sprite = buildSprite([ { name: 'clipped', aliases: [] } ], [ 'clipped' ], fixture);
      expect(sprite).toContain('<clipPath id="clipped--a">');
      expect(sprite).toContain('<path id="clipped--b"');
      expect(sprite).toContain('clip-path="url(#clipped--a)"');
      expect(sprite).toContain('<use href="#clipped--b"/>');
      expect(sprite).toContain('<symbol id="clipped" viewBox="0 0 16 16">');
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it('writes no "--" inside a comment, which would make the sprite invalid XML', () => {
    for (const [ , comment ] of buildSprite(icons, [ 'close' ]).matchAll(/<!--([\s\S]*?)-->/g)) {
      expect(comment).not.toContain('--');
    }
  });

  it('reads the icon list of ui-icon, sorted and unique', () => {
    const names = readIconList();
    expect(names).toContain('close');
    expect(names).toEqual([ ...new Set(names) ].sort());
  });

  it('refuses an icon list it cannot parse', () => {
    expect(() => readIconList('export const ICON_NAMES = names;')).toThrow(UI_ICON_LIST);
  });

  it('keeps the committed sprite in step with the icon list', () => {
    expect(readText(UI_SPRITE)).toBe(buildSprite(icons, readIconList()));
  });
});
