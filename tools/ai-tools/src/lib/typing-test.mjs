// Shared by the typing test page (bundled for the browser) and the command line: no Node imports.

/** The test files the page offers, by name, and their size limits in bytes (NF-2.4, NF-2.5, NF-1.5). */
export const TYPING_TEST_FILES = Object.freeze({
  /** The baseline: what the phone, the browser and the keyboard cost on their own. */
  '2kb.md': 2 * 1024,
  '100kb.md': 100 * 1024,
  '200kb.md': 200 * 1024,
  '500kb.md': 500 * 1024,
  '1mb.md': 1024 * 1024
});

/** The parts of the editor's setup that `?off=` can turn off, to find which one costs the time. */
export const SWITCHES = Object.freeze({
  frontmatter: 'front matter highlighting',
  language: 'Markdown highlighting, front matter included',
  wrap: 'soft wrap',
  linenumbers: 'line numbers and the active-line gutter',
  wrapmarker: 'the wrap marker gutter',
  spellcheck: 'spell check and autocorrect',
  direction: 'per-line text direction'
});

/** The setups offered in the page's menu: which switches each turns off. */
export const SETUPS = Object.freeze([
  [],
  [ 'frontmatter' ],
  [ 'language' ],
  [ 'wrap' ],
  [ 'spellcheck' ],
  [ 'direction' ],
  [ 'linenumbers', 'wrapmarker' ],
  [ 'language', 'wrap', 'spellcheck', 'direction' ]
]);

/**
 * The file and switches named by the page's address: `?file=1mb.md&off=wrap,spellcheck`.
 * An unknown file falls back to the first; unknown switches are returned apart, so the
 * page can say so instead of silently measuring the wrong setup.
 */
export function parseSetup(search) {
  const params = new URLSearchParams(search);
  const names = Object.keys(TYPING_TEST_FILES);
  const file = names.includes(params.get('file')) ? params.get('file') : names[0];
  const asked = (params.get('off') ?? '').split(',').map(name => name.trim()).filter(Boolean);
  return {
    file,
    off: Object.keys(SWITCHES).filter(name => asked.includes(name)),
    unknown: asked.filter(name => !(name in SWITCHES))
  };
}

/** The address query of a setup, the inverse of `parseSetup`. */
export function setupQuery({ file, off }) {
  return off.length ? `?file=${file}&off=${off.join(',')}` : `?file=${file}`;
}

/** The keystroke budget of NF-2.4, in milliseconds. */
export const KEYSTROKE_BUDGET_MS = 50;

const WORDS = (
  'the editor saves each file shortly after typing stops and keeps unsaved edits in the browser until '
  + 'the backend confirms them while the preview renders markdown with tables lists code blocks and links '
  + 'repository working copy branch commit push pull remote conflict merge folder image heading paragraph '
  + 'phone desktop keyboard screen reader contrast session token instance operator administrator user'
).split(' ');

const ARABIC = 'يحفظ المحرر الملف بعد توقف الكتابة بقليل ويبقي التعديلات غير المحفوظة في المتصفح.';

/** A small seeded generator (mulberry32), so that every build makes the same files. */
function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Markdown that looks like documentation: YAML front matter, then sections of
 * headings, paragraphs with inline markup, lists, fenced code, tables and
 * quotes, with an Arabic paragraph now and then (ED-13). Whole blocks are
 * added while the UTF-8 size stays at or below `maxBytes`.
 */
export function generateMarkdown(maxBytes, seed = 1) {
  const next = random(seed);
  const pick = list => list[Math.floor(next() * list.length)];
  const words = count => Array.from({ length: count }, () => pick(WORDS)).join(' ');
  const sentence = () => {
    const text = words(8 + Math.floor(next() * 12));
    const marked = next() < 0.3
      ? text.replace(/ (\w+) /, ' **$1** ')
      : next() < 0.3
      ? text.replace(/ (\w+) /, ' `$1` ')
      : text;
    return marked.charAt(0).toUpperCase() + marked.slice(1) + '.';
  };
  const paragraph = () => Array.from({ length: 3 + Math.floor(next() * 4) }, sentence).join(' ');

  const blocks = [ '---\ntitle: Typing test\ntags: [ editor, performance ]\ndraft: false\n---' ];
  const encoder = new TextEncoder();
  let size = encoder.encode(blocks[0]).length;
  for (let section = 1;; section++) {
    const parts = [ `## Section ${section}: ${words(3)}`, paragraph(), paragraph() ];
    const kind = section % 5;
    if (kind === 0) {
      parts.push(Array.from({ length: 4 }, () => `- ${sentence()}`).join('\n'));
    } else if (kind === 1) {
      parts.push(
        [
          '```ts',
          `export function step${section}(input: string): string {`,
          `  return input.trim(); // ${words(4)}`,
          '}',
          '```'
        ].join('\n')
      );
    } else if (kind === 2) {
      parts.push(
        [
          '| Name | Value | Note |',
          '| ---- | ----- | ---- |',
          ...Array.from({ length: 4 }, () => `| ${pick(WORDS)} | ${Math.floor(next() * 1000)} | ${words(3)} |`)
        ].join('\n')
      );
    } else if (kind === 3) {
      parts.push(`> ${sentence()} See [the guide](docs/guide-${section}.md).`);
    } else {
      parts.push(Array.from({ length: 3 }, (_, index) => `${index + 1}. ${sentence()}`).join('\n'));
    }
    if (section % 20 === 0) {
      parts.push(ARABIC);
    }
    const block = parts.join('\n\n');
    const blockSize = encoder.encode(`\n\n${block}`).length;
    if (size + blockSize + 1 > maxBytes) {
      return `${blocks.join('\n\n')}\n`;
    }
    blocks.push(block);
    size += blockSize;
  }
}

/** Count, median, 95th percentile (nearest rank), maximum and keystrokes over the budget, in whole ms. */
export function summarise(durations, budget = KEYSTROKE_BUDGET_MS) {
  if (!durations.length) {
    return { count: 0, median: null, p95: null, max: null, over: 0 };
  }
  const sorted = [ ...durations ].sort((a, b) => a - b);
  const rank = share => sorted[Math.max(0, Math.ceil(share * sorted.length) - 1)];
  return {
    count: sorted.length,
    median: Math.round(rank(0.5)),
    p95: Math.round(rank(0.95)),
    max: Math.round(sorted[sorted.length - 1]),
    over: sorted.filter(duration => duration > budget).length
  };
}

/**
 * Keystrokes per second, from the start times of the measured keystrokes, or
 * null for fewer than two. Faster typing queues keystrokes behind each other's
 * work, so runs are compared at similar speeds.
 */
export function typingSpeed(starts) {
  if (starts.length < 2) {
    return null;
  }
  const seconds = (Math.max(...starts) - Math.min(...starts)) / 1000;
  return seconds > 0 ? Math.round(((starts.length - 1) / seconds) * 10) / 10 : null;
}

/**
 * The browser's Event Timing entries of key and input events, as one time per
 * keystroke: entries whose frames end within `frameGap` ms of each other belong
 * to one keystroke (Chromium rounds durations to 8 ms), and its time runs from
 * its first event to that frame on screen.
 */
export function keystrokeTimings(entries, frameGap = 8) {
  const sorted = [ ...entries ].sort((a, b) => a.startTime + a.duration - (b.startTime + b.duration));
  const groups = [];
  for (const entry of sorted) {
    const end = entry.startTime + entry.duration;
    const last = groups[groups.length - 1];
    if (last && end - last.end <= frameGap) {
      last.start = Math.min(last.start, entry.startTime);
      last.end = Math.max(last.end, end);
    } else {
      groups.push({ start: entry.startTime, end });
    }
  }
  return groups.map(group => group.end - group.start);
}

/**
 * The text of **Copy results**: what the user pastes into the report
 * (docs/wiki/typing-test.md).
 */
export function formatResults(run) {
  const own = summarise(run.durations);
  const slowest = [ ...run.durations ].sort((a, b) => b - a).slice(0, 10).map(Math.round);
  const lines = [
    `file: ${run.file} (${run.bytes.toLocaleString('en')} bytes)`,
    `switched off: ${run.off.length ? run.off.join(', ') : 'nothing'}`,
    `typed at: ${run.position === null ? 'n/a' : `${run.position} % of the file`}`,
    `keystrokes: ${own.count}`,
    `typing speed: ${typingSpeed(run.starts) ?? '—'} keys/s`,
    own.count
      ? `median: ${own.median} ms · p95: ${own.p95} ms · max: ${own.max} ms · over ${KEYSTROKE_BUDGET_MS} ms: ${own.over}`
      : 'no keystrokes measured',
    `slowest: ${slowest.length ? slowest.join(', ') : '—'}`
  ];
  if (run.eventTiming === null) {
    lines.push('browser timing: not supported by this browser');
  } else {
    const timing = summarise(keystrokeTimings(run.eventTiming));
    lines.push(
      timing.count
        ? `browser timing: ${timing.count} keystrokes of 16 ms or more · max: ${timing.max} ms · over ${KEYSTROKE_BUDGET_MS} ms: ${timing.over}`
        : 'browser timing: no keystroke took 16 ms or more'
    );
  }
  lines.push(`browser: ${run.userAgent}`, `screen: ${run.screen}`);
  return lines.join('\n');
}
