import { contrastRatio, relativeLuminance } from './contrast.util';

describe('contrast', () => {
  it('gives black a luminance of 0 and white a luminance of 1', () => {
    expect(relativeLuminance([ 0, 0, 0 ])).toBe(0);
    expect(relativeLuminance([ 255, 255, 255 ])).toBeCloseTo(1);
  });

  it('gives black on white a ratio of 21', () => {
    expect(contrastRatio([ 0, 0, 0 ], [ 255, 255, 255 ])).toBeCloseTo(21);
  });

  it('does not depend on the order of the colours', () => {
    expect(contrastRatio([ 255, 255, 255 ], [ 118, 118, 118 ])).toBeCloseTo(
      contrastRatio([ 118, 118, 118 ], [ 255, 255, 255 ])
    );
  });

  it('matches the WCAG threshold for #767676 on white', () => {
    // #767676 is the lightest grey that meets 4.5:1 on white.
    expect(contrastRatio([ 118, 118, 118 ], [ 255, 255, 255 ])).toBeCloseTo(4.54, 2);
  });
});
