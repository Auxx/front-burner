/**
 * A progress line of `git clone --progress`, such as `Receiving objects:  45%
 * (450/1000), 1.2 MiB | 1.0 MiB/s` or `remote: Counting objects: 100% (5/5),
 * done.` git rewrites a line in place with `\r`, so each update is one segment.
 */
const PROGRESS_LINE = /^(?:remote: )?[A-Z][a-z]+(?: [a-z]+)*: +(?:\d+%|\d+, done\.)/;

/** The phases on this side that the clone's percentage is made of, with the share of each. */
const PHASES: readonly { pattern: RegExp; start: number; share: number; }[] = [
  { pattern: /^Receiving objects: +(\d+)%/, start: 0, share: 80 },
  { pattern: /^Resolving deltas: +(\d+)%/, start: 80, share: 20 }
];

/**
 * Turns the stderr of `git clone --progress`, chunk by chunk, into one
 * percentage for the whole clone (RM-7): receiving objects is the first 80 %,
 * resolving deltas the rest. What the remote counts and compresses first is
 * not counted, since its size is not known. Reports only rises.
 */
export class CloneProgressParser {
  private partial = '';
  private last = -1;

  constructor(private readonly report: (percent: number) => void) {}

  push(text: string): void {
    const segments = (this.partial + text).split(/[\r\n]/);
    this.partial = segments.pop() ?? '';
    for (const segment of segments) {
      this.read(segment);
    }
  }

  private read(segment: string): void {
    for (const phase of PHASES) {
      const match = phase.pattern.exec(segment);
      if (match !== null) {
        const percent = Math.round(phase.start + phase.share * Math.min(Number(match[1]), 100) / 100);
        if (percent > this.last) {
          this.last = percent;
          this.report(percent);
        }
        return;
      }
    }
  }
}

/**
 * The stderr of a git run with `--progress`, without its progress lines, so
 * that a failure is classified and recorded from git's messages only (AR-53,
 * RM-10). Every other line is kept as it is.
 */
export function withoutProgress(stderr: string): string {
  return stderr
    .split('\n')
    .map(line => line.split('\r').filter(segment => !PROGRESS_LINE.test(segment)).join('\r'))
    .filter((line, i, lines) => line !== '' || i === lines.length - 1)
    .join('\n');
}
