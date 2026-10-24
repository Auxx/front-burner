/** An sRGB colour with channels from 0 to 255. */
export type Rgb = readonly [ number, number, number ];

/** WCAG 2.2 relative luminance of an sRGB colour. */
export function relativeLuminance([ r, g, b ]: Rgb): number {
  const [ lr, lg, lb ] = [ r, g, b ].map(channel => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

/** WCAG 2.2 contrast ratio of two sRGB colours, from 1 to 21. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const [ lighter, darker ] = [ relativeLuminance(a), relativeLuminance(b) ].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}
