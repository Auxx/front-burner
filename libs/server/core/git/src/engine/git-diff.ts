export type DiffLineType = 'context' | 'added' | 'removed';

export interface DiffLine {
  type: DiffLineType;
  /** In the last commit's version; `null` for an added line. */
  oldLine: number | null;
  /** In the working tree's version; `null` for a removed line. */
  newLine: number | null;
  /** Without git's prefix and the line break; a trailing `\r` is kept (GA-16). */
  text: string;
}

/** One file's difference from the last commit (GA-14 to GA-16). */
export type FileDiff =
  | {
    kind: 'text';
    lines: DiffLine[];
    /** Every unchanged line is included, so every fold can be opened. */
    complete: boolean;
    /** Only the line endings changed (GA-16). */
    lineEndingsOnly: boolean;
  }
  | {
    kind: 'binary';
    /** In bytes; `null` when that side does not exist. */
    oldSize: number | null;
    newSize: number | null;
  }
  | { kind: 'too-large'; };

/** `@@ -<old>[,<count>] +<new>[,<count>] @@`; a missing count is 1. */
const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * Reads the hunks of a one-file unified diff. Lines are counted by each hunk's
 * header, so content that looks like a header (`--- a`, `+++ b`) stays
 * content, and git's `\ No newline at end of file` marker is never a line.
 */
export function parseUnifiedDiff(stdout: string): DiffLine[] {
  const lines: DiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;
  let oldLeft = 0;
  let newLeft = 0;
  for (const raw of stdout.split('\n')) {
    if (oldLeft === 0 && newLeft === 0) {
      const header = HUNK_HEADER.exec(raw);
      if (header) {
        oldLine = Number(header[1]);
        newLine = Number(header[3]);
        oldLeft = Number(header[2] ?? 1);
        newLeft = Number(header[4] ?? 1);
      }
      // Anything else outside a hunk is a file header, or the marker after a hunk's last line.
      continue;
    }
    const text = raw.slice(1);
    if (raw.startsWith(' ')) {
      lines.push({ type: 'context', oldLine: oldLine++, newLine: newLine++, text });
      oldLeft--;
      newLeft--;
    } else if (raw.startsWith('-')) {
      lines.push({ type: 'removed', oldLine: oldLine++, newLine: null, text });
      oldLeft--;
    } else if (raw.startsWith('+')) {
      lines.push({ type: 'added', oldLine: null, newLine: newLine++, text });
      newLeft--;
    }
    // `\` is the no-newline marker, inside a hunk when it follows a removed line.
  }
  return lines;
}
