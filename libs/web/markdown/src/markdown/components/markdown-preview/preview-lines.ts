/**
 * Places in the preview as lines of the file (ED-35, ED-36). A place is a
 * fractional line: the top block's first line plus the share of the block's
 * lines that the top has passed. So `12.5` in a block of lines 10 to 14 is
 * half-way down that block. Blocks are the children of the container, in
 * file order, with `data-from-line` and `data-to-line` (A-8.12).
 */

/** The block whose lines hold `line`, else the nearest block shown, or `null` when there is none. */
export function blockAtLine(container: HTMLElement, line: number): HTMLElement | null {
  const blocks = container.children;
  if (blocks.length === 0) {
    return null;
  }
  // The last block that starts at or before the line.
  let low = 0;
  let high = blocks.length - 1;
  let before = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (fromLine(blocks[middle]) <= line) {
      before = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  if (before === -1) {
    return blocks[0] as HTMLElement;
  }
  // The first block that holds the line: the footnote list shares the last block's last line.
  while (before > 0 && toLine(blocks[before - 1]) >= line) {
    before--;
  }
  const block = blocks[before] as HTMLElement;
  const next = blocks[before + 1] as HTMLElement | undefined;
  if (toLine(block) >= line || !next) {
    return block;
  }
  // Between two blocks, such as when the line's block has not rendered yet.
  return line - toLine(block) <= fromLine(next) - line ? block : next;
}

/** The place at the top of the container's visible area, or `1` when it shows no block. */
export function topPlace(container: HTMLElement): number {
  const blocks = container.children;
  if (blocks.length === 0) {
    return 1;
  }
  const top = container.getBoundingClientRect().top;
  // The last block whose top is at or above the container's top.
  let low = 0;
  let high = blocks.length - 1;
  let found = 0;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (blocks[middle].getBoundingClientRect().top <= top) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  const block = blocks[found];
  const rect = block.getBoundingClientRect();
  const share = rect.height > 0 ? clamp((top - rect.top) / rect.height) : 0;
  return fromLine(block) + share * lineCount(block);
}

/**
 * The container's `scrollTop` that puts `place` at the top: the block holding
 * its line, and the same share of that block's height. A place outside the
 * nearest block goes to that block's start or end. `null` when there is no block.
 */
export function scrollTopOf(container: HTMLElement, place: number): number | null {
  const block = blockAtLine(container, Math.floor(place));
  if (!block) {
    return null;
  }
  const share = clamp((place - fromLine(block)) / lineCount(block));
  const offset = block.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
  return offset + share * block.getBoundingClientRect().height;
}

function fromLine(block: Element): number {
  return Number(block.getAttribute('data-from-line'));
}

function toLine(block: Element): number {
  return Number(block.getAttribute('data-to-line'));
}

function lineCount(block: Element): number {
  return Math.max(1, toLine(block) - fromLine(block) + 1);
}

function clamp(share: number): number {
  return Math.min(Math.max(share, 0), 1);
}
