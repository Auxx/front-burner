import { normalizeIdentifier } from 'micromark-util-normalize-identifier';

/** A footnote that a block references, numbered across the whole file. */
export interface FootnoteUse {
  /** The normalised label. */
  label: string;
  /** The footnote's number in the file. */
  number: number;
  /** Which reference to the footnote in the file is the block's first, from 1. */
  first: number;
}

/** A top-level block of the source (A-8.12). */
export interface SourceBlock {
  /** A hash of the text, the link reference definitions it uses and its footnotes' numbers. */
  key: string;
  text: string;
  /** The first line, 1-based, in the whole file. */
  fromLine: number;
  /** The last line, 1-based and inclusive. */
  toLine: number;
  /** The footnotes the block references, with a definition in the file, in the order they first appear. */
  footnotes: readonly FootnoteUse[];
}

/** The file's footnotes, numbered in the order they are first referenced (plan 29). */
export interface FootnoteIndex {
  /** The number of every referenced footnote with a definition, by normalised label. */
  numbers: ReadonlyMap<string, number>;
  /** The text of every footnote definition, by normalised label; the first definition wins. */
  definitions: ReadonlyMap<string, string>;
  /** How many times each numbered footnote is referenced in the file. */
  counts: ReadonlyMap<string, number>;
}

export interface SplitSource {
  blocks: SourceBlock[];
  /** Every link reference definition of the file, one after another, to append to every block. */
  definitions: string;
  footnotes: FootnoteIndex;
}

const BLANK = /^\s*$/;
const ATX_HEADING = /^#{1,6}(?:[ \t]|$)/;
const LIST_MARKER = /^(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/;
const FENCE_OPEN = /^\s*(`{3,}|~{3,})(.*)$/;
const DEFINITION = /^ {0,3}\[((?:[^\\[\]]|\\.)+)\]:/;
const DEFINITION_CONTINUATION = /^\s+\S|^["'(]/;
const FOOTNOTE_REFERENCE = /\[\^([^\]\s]+)\]/g;
const BRACKETS = /\[([^[\]]+)\]/g;
const CODE_SPAN = /(`+)[^`]*?\1/g;
const FRONT_MATTER = /^---\s*$/;

/** The HTML blocks of CommonMark that may hold blank lines, and the text that ends each. */
const HTML_BLOCKS: readonly (readonly [ RegExp, RegExp ])[] = [
  [ /^\s*<(?:script|pre|style|textarea)(?:[\s>]|$)/i, /<\/(?:script|pre|style|textarea)>/i ],
  [ /^\s*<!--/, /-->/ ],
  [ /^\s*<\?/, /\?>/ ],
  [ /^\s*<!\[CDATA\[/, /\]\]>/ ],
  [ /^\s*<![A-Za-z]/, />/ ]
];
/** Any other HTML block, which ends at a blank line. */
const HTML_START = /^\s*<\/?[A-Za-z]/;

/** Ends an HTML block at a blank line. */
const UNTIL_BLANK = 'blank';

interface ScannedBlock {
  from: number;
  to: number;
  footnoteReferences: string[] | null;
  labels: Set<string> | null;
}

interface FootnoteDefinition {
  label: string;
  from: number;
  to: number;
}

/**
 * Splits Markdown into top-level blocks with a line scanner (A-8.12). A block
 * ends before a non-indented line after a blank line, unless that line
 * continues a list, and before a non-indented ATX heading; never inside a
 * fenced code block or an HTML block. When in doubt the scanner keeps lines
 * together, which only costs rendering time: a block split in the wrong place
 * would render wrongly. Front matter at the start is not a block.
 */
export function splitBlocks(source: string): SplitSource {
  const sourceLines = new Lines(source);
  const lines = sourceLines.lines;
  const scanned: ScannedBlock[] = [];
  const linkDefinitions: { label: string; from: number; to: number; }[] = [];
  const footnoteDefinitions: FootnoteDefinition[] = [];

  let block: ScannedBlock | null = null;
  let lastNonBlank = -1;
  let blank = false;
  let previousDefinition = false;
  let definitionTo = -1;
  let inList = false;
  let fence: { char: string; length: number; } | null = null;
  let htmlEnd: RegExp | typeof UNTIL_BLANK | null = null;
  let footnote: FootnoteDefinition | null = null;

  const endFootnote = (to: number) => {
    if (footnote) {
      footnote.to = to;
      footnote = null;
    }
  };
  const endBlock = () => {
    if (block) {
      block.to = lastNonBlank;
      scanned.push(block);
    }
    endFootnote(lastNonBlank);
  };

  for (let index = frontMatterEnd(lines); index < lines.length; index++) {
    const line = lines[index];
    if (fence) {
      lastNonBlank = BLANK.test(line) ? lastNonBlank : index;
      if (closesFence(line, fence)) {
        fence = null;
      }
      continue;
    }
    if (htmlEnd && htmlEnd !== UNTIL_BLANK) {
      lastNonBlank = BLANK.test(line) ? lastNonBlank : index;
      if (htmlEnd.test(line)) {
        htmlEnd = null;
      }
      continue;
    }
    if (BLANK.test(line)) {
      blank = true;
      previousDefinition = false;
      if (htmlEnd === UNTIL_BLANK) {
        htmlEnd = null;
      }
      continue;
    }
    const indented = line[0] === ' ' || line[0] === '\t';
    if (!block) {
      block = newBlock(index);
    } else if (
      htmlEnd !== UNTIL_BLANK && !indented
      && (blank ? !(inList && LIST_MARKER.test(line)) : ATX_HEADING.test(line))
    ) {
      endBlock();
      block = newBlock(index);
      inList = false;
    }
    // A definition may follow a blank line, another definition or a footnote's text.
    const mayDefine: boolean = blank || block.from === index || previousDefinition || footnote !== null;
    blank = false;
    const previousNonBlank = lastNonBlank;
    lastNonBlank = index;
    if (htmlEnd === UNTIL_BLANK) {
      continue;
    }
    if (index <= definitionTo) {
      continue;
    }
    const lead = line[0] === ' ' || line[0] === '\t' ? line.search(/\S/) : 0;
    const first = line[lead];
    if (!indented && LIST_MARKER.test(line)) {
      inList = true;
    }

    const opened = first === '`' || first === '~' ? FENCE_OPEN.exec(line) : null;
    if (opened && !(opened[1][0] === '`' && opened[2].includes('`'))) {
      fence = { char: opened[1][0], length: opened[1].length };
      previousDefinition = false;
      continue;
    }
    htmlEnd = first === '<' ? htmlBlockEnd(line) : null;
    if (htmlEnd) {
      previousDefinition = false;
      continue;
    }

    let text = line;
    const definition: RegExpExecArray | null = mayDefine && first === '[' ? DEFINITION.exec(line) : null;
    previousDefinition = definition !== null;
    if (definition) {
      endFootnote(previousNonBlank);
      const label: string = definition[1];
      if (label.startsWith('^')) {
        footnote = { label: normalizeLabel(label.slice(1)), from: index, to: index };
        footnoteDefinitions.push(footnote);
      } else {
        definitionTo = definitionEnd(lines, index);
        linkDefinitions.push({ label: normalizeLabel(label), from: index, to: definitionTo });
      }
      text = line.slice(definition[0].length);
    }
    scanReferences(text, block);
  }
  endBlock();

  return assemble(sourceLines, scanned, linkDefinitions, footnoteDefinitions);
}

function newBlock(from: number): ScannedBlock {
  return { from, to: from, footnoteReferences: null, labels: null };
}

/** The index of the first line after front matter, as `remark-frontmatter` reads it. */
function frontMatterEnd(lines: readonly string[]): number {
  if (!FRONT_MATTER.test(lines[0])) {
    return 0;
  }
  for (let index = 1; index < lines.length; index++) {
    if (FRONT_MATTER.test(lines[index])) {
      return index + 1;
    }
  }
  return 0;
}

function closesFence(line: string, fence: { char: string; length: number; }): boolean {
  const trimmed = line.trim();
  return trimmed.length >= fence.length && [ ...trimmed ].every(char => char === fence.char);
}

function htmlBlockEnd(line: string): RegExp | typeof UNTIL_BLANK | null {
  for (const [ start, end ] of HTML_BLOCKS) {
    const match = start.exec(line);
    if (match) {
      return end.test(line.slice(match[0].length)) ? null : end;
    }
  }
  return HTML_START.test(line) ? UNTIL_BLANK : null;
}

/** The last line of a link reference definition whose title or destination is on the next lines. */
function definitionEnd(lines: readonly string[], from: number): number {
  let to = from;
  while (to + 1 < lines.length && to - from < 2 && DEFINITION_CONTINUATION.test(lines[to + 1])) {
    to++;
  }
  return to;
}

function scanReferences(line: string, block: ScannedBlock): void {
  const text = line.includes('`') ? line.replace(CODE_SPAN, '') : line;
  if (!text.includes('[')) {
    return;
  }
  for (const match of text.matchAll(FOOTNOTE_REFERENCE)) {
    (block.footnoteReferences ??= []).push(normalizeLabel(match[1]));
  }
  for (const match of text.matchAll(BRACKETS)) {
    (block.labels ??= new Set()).add(normalizeLabel(match[1]));
  }
}

const normalizedLabels = new Map<string, string>();

/** A label as CommonMark matches labels: case and runs of white space do not count. */
function normalizeLabel(label: string): string {
  let normalized = normalizedLabels.get(label);
  if (normalized === undefined) {
    normalized = normalizeIdentifier(label).toLowerCase();
    if (normalizedLabels.size > 10_000) {
      normalizedLabels.clear();
    }
    normalizedLabels.set(label, normalized);
  }
  return normalized;
}

/** The source's lines, and the source's text from line to line without joining lines again. */
class Lines {
  readonly lines: readonly string[];
  private readonly source: string;
  private readonly starts: number[];

  constructor(source: string) {
    this.source = source.includes('\r') ? source.replace(/\r\n?/g, '\n') : source;
    this.lines = this.source.split('\n');
    this.starts = new Array<number>(this.lines.length);
    let start = 0;
    for (let index = 0; index < this.lines.length; index++) {
      this.starts[index] = start;
      start += this.lines[index].length + 1;
    }
  }

  /** Lines `from` to `to`, inclusive. */
  text(from: number, to: number): string {
    return this.source.slice(this.starts[from], this.starts[to] + this.lines[to].length);
  }
}

function assemble(
  lines: Lines,
  scanned: readonly ScannedBlock[],
  linkDefinitions: readonly { label: string; from: number; to: number; }[],
  footnoteDefinitions: readonly FootnoteDefinition[]
): SplitSource {
  const definitionTexts = new Map<string, string>();
  for (const definition of linkDefinitions) {
    if (!definitionTexts.has(definition.label)) {
      definitionTexts.set(definition.label, lines.text(definition.from, definition.to));
    }
  }
  const footnoteTexts = new Map<string, string>();
  for (const definition of footnoteDefinitions) {
    if (!footnoteTexts.has(definition.label)) {
      footnoteTexts.set(definition.label, lines.text(definition.from, definition.to));
    }
  }

  const numbers = new Map<string, number>();
  const counts = new Map<string, number>();
  const blocks = scanned.map(scannedBlock => {
    const footnotes: FootnoteUse[] = [];
    for (const label of scannedBlock.footnoteReferences ?? []) {
      if (!footnoteTexts.has(label)) {
        continue;
      }
      if (!numbers.has(label)) {
        numbers.set(label, numbers.size + 1);
      }
      const count = (counts.get(label) ?? 0) + 1;
      counts.set(label, count);
      if (!footnotes.some(use => use.label === label)) {
        footnotes.push({ label, number: numbers.get(label) ?? 0, first: count });
      }
    }
    const text = lines.text(scannedBlock.from, scannedBlock.to);
    const used = scannedBlock.labels && definitionTexts.size > 0
      ? [ ...scannedBlock.labels ].flatMap(label => definitionTexts.get(label) ?? []).sort()
      : [];
    const footnoteKey = footnotes.map(use => `${use.label}:${use.number}:${use.first}`);
    return {
      key: hashKey(text, ...used, ...footnoteKey),
      text,
      fromLine: scannedBlock.from + 1,
      toLine: scannedBlock.to + 1,
      footnotes
    };
  });

  return {
    blocks,
    definitions: linkDefinitions.map(definition => lines.text(definition.from, definition.to)).join('\n'),
    footnotes: { numbers, definitions: footnoteTexts, counts }
  };
}

/**
 * A 53-bit hash (cyrb53) of the parts and their total length: collisions are
 * out of reach for a file's blocks.
 */
export function hashKey(...parts: readonly string[]): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  let length = 0;
  for (const part of parts) {
    for (let index = 0; index < part.length; index++) {
      const code = part.charCodeAt(index);
      h1 = Math.imul(h1 ^ code, 2654435761);
      h2 = Math.imul(h2 ^ code, 1597334677);
    }
    // A separator, so that moving text from one part to the next changes the hash.
    h1 = Math.imul(h1 ^ 0xffff, 2654435761);
    h2 = Math.imul(h2 ^ 0xffff, 1597334677);
    length += part.length + 1;
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hash = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return `${hash.toString(36)}-${length.toString(36)}`;
}
