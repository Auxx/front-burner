/** A part of a conflict region, as document offsets. */
export interface ConflictPart {
  from: number;
  to: number;
}

/**
 * One conflict in a document, written with git's plain merge style (GC-5), as document
 * offsets. `from` is the start of the `<<<<<<<` line and `to` the end of the `>>>>>>>` line,
 * without the line break after it. Each part holds its whole lines, each with its line break,
 * so an empty part has `from === to`. The labels are the branch names on the marker lines.
 */
export interface ConflictRegion {
  from: number;
  to: number;
  ours: ConflictPart;
  theirs: ConflictPart;
  oursLabel: string;
  theirsLabel: string;
}

const START = '<<<<<<< ';
const MIDDLE = '=======';
const END = '>>>>>>> ';

/** A region being read: its start line, and its middle line once found. */
interface Open {
  from: number;
  oursFrom: number;
  oursLabel: string;
  middle: { from: number; to: number; } | null;
}

/**
 * The conflict regions in `lines`, the lines of a document without their line breaks. Goes
 * through them once. Lines that do not make up a whole region are plain text (GC-11): a
 * region with no middle or no end is left out, and a second start before the end starts over,
 * since git's markers do not nest.
 */
export function regionsInLines(lines: Iterable<string>): ConflictRegion[] {
  const regions: ConflictRegion[] = [];
  let open: Open | null = null;
  let from = 0;
  for (const line of lines) {
    const to = from + line.length;
    if (line.startsWith(START)) {
      open = {
        from,
        oursFrom: to + 1,
        oursLabel: line.slice(START.length).trimEnd(),
        middle: null
      };
    } else if (open && !open.middle && line === MIDDLE) {
      open.middle = { from, to };
    } else if (open && line.startsWith(END)) {
      if (open.middle) {
        regions.push({
          from: open.from,
          to,
          ours: { from: open.oursFrom, to: open.middle.from },
          theirs: { from: open.middle.to + 1, to: from },
          oursLabel: open.oursLabel,
          theirsLabel: line.slice(END.length).trimEnd()
        });
      }
      open = null;
    }
    from = to + 1;
  }
  return regions;
}

/** The conflict regions in `text`, whose lines end with `\n`. */
export function conflictRegions(text: string): ConflictRegion[] {
  return regionsInLines(text.split('\n'));
}
