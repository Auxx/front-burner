import { describe, expect, it } from 'vitest';
import { findIcons, loadIcons, readIcon } from './icons.mjs';

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
});
