import { describe, expect, it } from 'vitest';
import {
  composite,
  describeColour,
  formatOklch,
  isClose,
  measureContrast,
  parseColour,
  solveLightness,
  srgb8
} from './colour.mjs';

const c = parseColour;

describe('colour', () => {
  it('converts between notations', () => {
    expect(describeColour(c('#3574F0'))).toEqual({
      oklch: 'oklch(58.8% 0.198 262)',
      hex: '#3574f0',
      rgb: 'rgb(53 116 240)',
      inGamut: true
    });
    expect(describeColour(c('oklch(100% 0 0)')).hex).toBe('#ffffff');
  });

  it('formats OKLCH as the token files do, with alpha when there is one', () => {
    expect(formatOklch(c('oklch(55% 0.19 262)'))).toBe('oklch(55% 0.19 262)');
    expect(formatOklch({ ...c('black'), alpha: 0.05 })).toBe('oklch(0% 0 0 / 5%)');
  });

  it('flags colours outside sRGB and clips them per channel', () => {
    const red = describeColour(c('oklch(70% 0.4 30)'));
    expect(red.inGamut).toBe(false);
    expect(red.hex).toBe('#ff0000');
  });

  it('refuses text that is not a colour', () => {
    expect(() => parseColour('not-a-colour')).toThrow('Not a colour');
  });

  it('measures WCAG contrast', () => {
    expect(measureContrast(c('white'), [ c('black') ]).ratio).toBe(21);
    expect(measureContrast(c('#777'), [ c('white') ]).ratio).toBeCloseTo(4.48, 2);
  });

  it('paints translucent layers over the ones below in 8 bits', () => {
    const hover = { ...c('black'), alpha: 0.05 };
    expect(composite([ c('white'), hover ])).toEqual({ r: 242, g: 242, b: 242, alpha: 1 });
    expect(srgb8(c('oklch(95% 0.005 265)'))).toEqual({ r: 237, g: 238, b: 242, alpha: 1 });
  });

  it('reports a background that lets the page show through', () => {
    expect(measureContrast(c('black'), [ { ...c('white'), alpha: 0.5 } ]).opaque).toBe(false);
    expect(measureContrast(c('black'), [ c('white') ]).opaque).toBe(true);
  });

  it('solves the lightness range that meets a minimum', () => {
    const { ranges } = solveLightness({ background: [ c('white') ], hue: 265, chroma: 0, minimum: 4.5 });
    expect(ranges).toHaveLength(1);
    expect(ranges[0].from).toBe(0);
    // #767676 is the lightest grey with 4.5:1 on white, OKLCH lightness 56.9 %.
    expect(ranges[0].to).toBeCloseTo(56.9, 0);
  });

  it('solves both sides of a mid-grey background', () => {
    const { ranges } = solveLightness({ background: [ c('#808080') ], hue: 0, chroma: 0, minimum: 3 });
    expect(ranges).toHaveLength(2);
    expect(ranges[1].to).toBe(100);
  });

  it('marks ratios just above the minimum as close', () => {
    expect(isClose(4.55, 4.5)).toBe(true);
    expect(isClose(4.7, 4.5)).toBe(false);
    expect(isClose(4.4, 4.5)).toBe(false);
  });
});
