import type { DiffLine, GitDiff } from '@front-burner/shared-contracts';

/** One file's difference from the last commit (GA-14 to GA-16), as the API answers it. */
export type FileDiff = GitDiff;

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

/** Strips the carriage return a CRLF line keeps. */
const withoutCr = (text: string) => (text.endsWith('\r') ? text.slice(0, -1) : text);

/**
 * True when a whole-file diff changes lines, and the two versions it holds are
 * the same once each line's trailing `\r` is ignored (GA-16), as git's
 * `--ignore-cr-at-eol` compares them. Only for a diff with every line.
 */
export function onlyLineEndingsDiffer(lines: DiffLine[]): boolean {
  if (lines.every(line => line.type === 'context')) {
    return false;
  }
  const before = lines.filter(line => line.type !== 'added').map(line => withoutCr(line.text));
  const after = lines.filter(line => line.type !== 'removed').map(line => withoutCr(line.text));
  return before.length === after.length && before.every((text, index) => text === after[index]);
}
