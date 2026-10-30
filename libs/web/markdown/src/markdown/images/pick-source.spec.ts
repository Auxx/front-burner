import { parseSrcset, pickCandidate, pickPictureSource } from './pick-source';

describe('parseSrcset', () => {
  it('reads density and width descriptors, and skips invalid ones', () => {
    expect(parseSrcset('a.png, b.png 2x, c.png 1.5x,  d.png 640w, e.png 0x, f.png 2q')).toEqual([
      { url: 'a.png', x: 1 },
      { url: 'b.png', x: 2 },
      { url: 'c.png', x: 1.5 },
      { url: 'd.png', w: 640 }
    ]);
  });
});

describe('pickCandidate', () => {
  it('picks the density closest above the pixel ratio, or the largest', () => {
    const candidates = parseSrcset('a.png 1x, b.png 2x, c.png 3x');

    expect(pickCandidate(candidates, { ratio: 1, width: 800 })).toBe('a.png');
    expect(pickCandidate(candidates, { ratio: 1.5, width: 800 })).toBe('b.png');
    expect(pickCandidate(candidates, { ratio: 4, width: 800 })).toBe('c.png');
    expect(pickCandidate([], { ratio: 1, width: 800 })).toBeNull();
  });

  it('picks the smallest width at least the preview\'s width times the ratio, or the largest', () => {
    const candidates = parseSrcset('s.png 400w, m.png 800w, l.png 1600w');

    expect(pickCandidate(candidates, { ratio: 1, width: 500 })).toBe('m.png');
    expect(pickCandidate(candidates, { ratio: 2, width: 500 })).toBe('l.png');
    expect(pickCandidate(candidates, { ratio: 1, width: 300 })).toBe('s.png');
    expect(pickCandidate(candidates, { ratio: 3, width: 1000 })).toBe('l.png');
  });
});

describe('pickPictureSource', () => {
  const env = (dark: boolean) => ({
    ratio: 1,
    width: 800,
    matches: (media: string) => media === '(prefers-color-scheme: dark)' && dark
  });
  const picture = {
    sources: [
      { media: '(prefers-color-scheme: dark)', type: null, srcset: 'dark.png' },
      { media: null, type: 'image/tiff', srcset: 'scan.tiff' },
      { media: '', type: 'IMAGE/WEBP', srcset: 'any.webp 1x, any@2x.webp 2x' }
    ],
    img: 'light.png'
  };

  it('picks the first source whose media matches and whose type is supported', () => {
    expect(pickPictureSource(picture, env(true))).toBe('dark.png');
    expect(pickPictureSource(picture, env(false))).toBe('any.webp');
  });

  it('falls back to the img', () => {
    expect(pickPictureSource({ sources: picture.sources.slice(0, 2), img: 'light.png' }, env(false))).toBe(
      'light.png'
    );
    expect(pickPictureSource({ sources: [], img: null }, env(false))).toBeNull();
  });
});
