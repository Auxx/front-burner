import { converter, formatHex, inGamut, parse } from 'culori';

const toOklch = converter('oklch');
const toRgb = converter('rgb');
const inSrgb = inGamut('rgb');

/** An sRGB colour as the browser's canvas stores it: channels 0–255, alpha 0–1. */
export function srgb8(colour) {
  const { r, g, b, alpha = 1 } = toRgb(colour);
  const channel = value => Math.round(Math.min(Math.max(value, 0), 1) * 255);
  return { r: channel(r), g: channel(g), b: channel(b), alpha };
}

/** Parses any CSS colour that culori knows; throws for anything else. */
export function parseColour(text) {
  const colour = parse(text.trim());
  if (!colour) {
    throw new Error(`Not a colour: ${text}`);
  }
  return colour;
}

const trim = (value, digits) => String(Number(value.toFixed(digits)));

/** Formats a colour as the token files write it: `oklch(55% 0.19 262)`. */
export function formatOklch(colour) {
  const { l, c, h, alpha } = toOklch(colour);
  const body = `${trim(l * 100, 1)}% ${trim(c, 3)} ${trim(h ?? 0, 1)}`;
  return alpha === undefined || alpha === 1 ? `oklch(${body})` : `oklch(${body} / ${trim(alpha * 100, 1)}%)`;
}

/** Every common notation of a colour, and whether it is inside the sRGB gamut. */
export function describeColour(colour) {
  const { r, g, b, alpha } = srgb8(colour);
  return {
    oklch: formatOklch(colour),
    hex: formatHex({ mode: 'rgb', r: r / 255, g: g / 255, b: b / 255 }),
    rgb: alpha === 1 ? `rgb(${r} ${g} ${b})` : `rgb(${r} ${g} ${b} / ${trim(alpha * 100, 1)}%)`,
    inGamut: inSrgb(colour)
  };
}

/**
 * Paints `colour` over `below` as the canvas does: source-over compositing in
 * sRGB, stored in 8 bits per channel after each layer. Out-of-gamut colours
 * are clipped per channel, as Chromium does.
 *
 * Chromium's own rounding differs slightly (its OKLCH conversion is off by
 * ±1 in a channel at times, and its compositing rounds differently for some
 * colours), so ratios can differ from the token page by up to 1.6 %
 * (measured on all 332 readings of the contrast pairs): see `CLOSE_MARGIN`.
 */
function paint(below, colour) {
  const top = srgb8(colour);
  const alpha = top.alpha + below.alpha * (1 - top.alpha);
  if (alpha === 0) {
    return { r: 0, g: 0, b: 0, alpha: 0 };
  }
  const mix = key => Math.round((top[key] * top.alpha + below[key] * below.alpha * (1 - top.alpha)) / alpha);
  return { r: mix('r'), g: mix('g'), b: mix('b'), alpha };
}

/**
 * A ratio less than this much above its minimum is "close": it passes here but
 * may fail in the browser, so it must be confirmed on the Storybook token page.
 */
export const CLOSE_MARGIN = 0.02;

/** Whether a passing `ratio` is within `CLOSE_MARGIN` of `minimum`. */
export const isClose = (ratio, minimum) => ratio >= minimum && ratio < minimum * (1 + CLOSE_MARGIN);

/** The colour of background layers painted from the bottom up. */
export function composite(layers) {
  return layers.reduce(paint, { r: 0, g: 0, b: 0, alpha: 0 });
}

/** WCAG 2.2 relative luminance of an 8-bit sRGB colour. */
export function relativeLuminance({ r, g, b }) {
  const [ lr, lg, lb ] = [ r, g, b ].map(channel => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

/**
 * The WCAG 2.2 contrast ratio of `foreground` painted on `background`, a list
 * of layers from the bottom up, measured as the Storybook token page does.
 * `opaque` is false when the background layers let the page show through, in
 * which case the ratio is not meaningful.
 */
export function measureContrast(foreground, background) {
  const below = composite(background);
  const above = paint(below, foreground);
  const [ lighter, darker ] = [ relativeLuminance(above), relativeLuminance(below) ].sort((x, y) => y - x);
  return { ratio: (lighter + 0.05) / (darker + 0.05), opaque: below.alpha === 1 };
}

/**
 * The OKLCH lightness ranges, in percent with one decimal, in which a colour
 * of the given hue and chroma meets `minimum` against `background`. Chroma
 * that leaves the sRGB gamut is clipped as the browser would; `clipped` lists
 * the ranges where that happens.
 */
export function solveLightness({ background, hue, chroma, minimum, alpha = 1 }) {
  // Ranges of steps of 0.1 %, as [first, last] pairs.
  const ranges = [];
  const clipped = [];
  const extend = (list, step) => {
    const last = list.at(-1);
    if (last && last[1] === step - 1) {
      last[1] = step;
    } else {
      list.push([ step, step ]);
    }
  };
  for (let step = 0; step <= 1000; step++) {
    const colour = { mode: 'oklch', l: step / 1000, c: chroma, h: hue, alpha };
    if (measureContrast(colour, background).ratio >= minimum) {
      extend(ranges, step);
      if (!inSrgb(colour)) {
        extend(clipped, step);
      }
    }
  }
  const percent = list => list.map(([ from, to ]) => ({ from: from / 10, to: to / 10 }));
  return { ranges: percent(ranges), clipped: percent(clipped) };
}
