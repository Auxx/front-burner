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
  /** A second middle was found, so the region is left out. */
  ambiguous: boolean;
}

/**
 * The conflict regions in `lines`, the lines of a document without their line breaks. Goes
 * through them once. Lines that do not make up a whole region are plain text (GC-11): a
 * region with no middle or no end is left out, and a second start before the end starts over,
 * since git's markers do not nest. A region with two middles is left out too: git writes its
 * markers seven characters long whatever the text holds, so one of them is a line of either
 * version, such as a Markdown heading's underline, and which side it belongs to can't be told.
 * The user edits such a region by hand rather than have **Accept** drop lines.
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
        middle: null,
        ambiguous: false
      };
    } else if (open && line === MIDDLE) {
      if (open.middle) {
        open.ambiguous = true;
      } else {
        open.middle = { from, to };
      }
    } else if (open && line.startsWith(END)) {
      if (open.middle && !open.ambiguous) {
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

/**
 * The conflict regions in `text`, whose lines end with `\n` as an editor document's do; its
 * offsets would be wrong for a file's raw text with `\r\n`, so it is not exported from the
 * library, where `conflictsIn` reads the editor's document.
 */
export function conflictRegions(text: string): ConflictRegion[] {
  return regionsInLines(text.split('\n'));
}
