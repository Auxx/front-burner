import { IMAGE_TYPES } from './resolve-image';

/** One candidate of a `srcset`: its address and its density (`x`) or width (`w`) descriptor. */
export interface SrcsetCandidate {
  url: string;
  x?: number;
  w?: number;
}

/** What picking an image depends on: the device pixel ratio and the preview's width in CSS pixels. */
export interface PickEnvironment {
  ratio: number;
  width: number;
}

/** A `<picture>`'s `<source>` elements, in order, and the address of its `<img>`. */
export interface PictureSources {
  sources: readonly { media: string | null; type: string | null; srcset: string; }[];
  img: string | null;
}

/**
 * The candidates of a `srcset`, split as `checkAddress` splits it. A
 * candidate without a descriptor counts as `1x`; one with a descriptor that
 * is not a positive `x` or `w` is skipped, as a browser skips it.
 */
export function parseSrcset(value: string): SrcsetCandidate[] {
  const candidates: SrcsetCandidate[] = [];
  for (const part of value.split(',')) {
    const [ url = '', descriptor ] = part.trim().split(/\s+/);
    if (!url) {
      continue;
    }
    const match = descriptor === undefined ? null : /^(\d+(?:\.\d+)?)([xw])$/i.exec(descriptor);
    if (descriptor === undefined) {
      candidates.push({ url, x: 1 });
    } else if (match && Number(match[1]) > 0) {
      const kind = match[2]?.toLowerCase() === 'w' ? 'w' : 'x';
      candidates.push({ url, [kind]: Number(match[1]) });
    }
  }
  return candidates;
}

/**
 * The candidate a browser would pick (IM-12): with width descriptors, the
 * smallest at least as wide as the preview times the pixel ratio, else the
 * widest; otherwise the smallest density at least the pixel ratio, else the
 * largest.
 */
export function pickCandidate(candidates: readonly SrcsetCandidate[], env: PickEnvironment): string | null {
  const widths = candidates.filter(candidate => candidate.w !== undefined);
  const [ list, value, wanted ] = widths.length > 0
    ? [ widths, (candidate: SrcsetCandidate) => candidate.w ?? 0, env.width * env.ratio ]
    : [ candidates, (candidate: SrcsetCandidate) => candidate.x ?? 1, env.ratio ];
  const sorted = [ ...list ].sort((a, b) => value(a) - value(b));
  return (sorted.find(candidate => value(candidate) >= wanted) ?? sorted.at(-1))?.url ?? null;
}

/**
 * The address a browser would show for a `<picture>` (IM-12): from the first
 * `<source>` whose `media` matches and whose `type` is empty or a format of
 * IM-9, else the `<img>`'s.
 */
export function pickPictureSource(
  picture: PictureSources,
  env: PickEnvironment & { matches(media: string): boolean; }
): string | null {
  for (const source of picture.sources) {
    const media = source.media?.trim();
    const type = source.type?.trim().toLowerCase();
    if ((media && !env.matches(media)) || (type && !IMAGE_TYPES.includes(type))) {
      continue;
    }
    const picked = pickCandidate(parseSrcset(source.srcset), env);
    if (picked !== null) {
      return picked;
    }
  }
  return picture.img;
}
