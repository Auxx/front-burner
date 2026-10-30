/** The class of an image placeholder (IM-18). */
export const PLACEHOLDER_CLASS = 'md-image-placeholder';

/** What a placeholder says: nothing while the image loads (IM-20), or why it is not shown (IM-18). */
export interface PlaceholderContent {
  alt: string;
  /** The reason the image is not shown; `null` while it loads. */
  reason: string | null;
  /** Shown after the reason, such as a remote image's host (IM-16). */
  detail?: string;
}

/**
 * Creates the placeholder of `img` (IM-18 to IM-22), built with DOM methods
 * only, so that no text of the file is ever read as HTML. It reserves the
 * space of the image's `width` and `height` (IM-11).
 */
export function createPlaceholder(img: HTMLImageElement, content: PlaceholderContent): HTMLElement {
  const placeholder = img.ownerDocument.createElement('span');
  placeholder.className = PLACEHOLDER_CLASS;
  reserveSize(placeholder, img);
  setPlaceholderContent(placeholder, content);
  return placeholder;
}

/**
 * Shows `content` in a placeholder. One that tells a reason is an image to
 * screen readers, named by the alt text followed by the reason (IM-21);
 * while the image loads it is named by the alt text alone, and an image
 * with no alt text, which is decorative, is hidden from them.
 */
export function setPlaceholderContent(placeholder: HTMLElement, { alt, reason, detail }: PlaceholderContent): void {
  const document = placeholder.ownerDocument;
  const said = reason === null ? '' : [ reason, detail ].filter(Boolean).join(' ');
  const name = [ alt.trim(), said ].filter(Boolean).join(', ');
  placeholder.toggleAttribute('data-loading', reason === null);
  if (name) {
    placeholder.setAttribute('role', 'img');
    placeholder.setAttribute('aria-label', name);
    placeholder.removeAttribute('aria-hidden');
  } else {
    placeholder.removeAttribute('role');
    placeholder.removeAttribute('aria-label');
    placeholder.setAttribute('aria-hidden', 'true');
  }
  const parts: HTMLElement[] = [];
  if (reason !== null) {
    if (alt.trim()) {
      parts.push(part(document, 'alt', alt.trim()));
    }
    parts.push(part(document, 'reason', reason));
    if (detail) {
      parts.push(part(document, 'detail', detail));
    }
  }
  placeholder.replaceChildren(...parts);
}

function part(document: Document, name: string, text: string): HTMLElement {
  const element = document.createElement('span');
  element.className = `${PLACEHOLDER_CLASS}__${name}`;
  element.textContent = text;
  return element;
}

/** The size written on an image (SH-11), as CSS: what of it the image's `width` and `height` say. */
export interface WrittenSize {
  /** Its `width`, in pixels or as a percentage. */
  inlineSize?: string;
  /** Its proportions, when both `width` and `height` are pixels. */
  aspectRatio?: string;
  /** Its `height`, when it has no `width`. */
  blockSize?: string;
}

/** Reads the size written on `img` (IM-11). */
export function writtenSize(img: HTMLImageElement): WrittenSize {
  const width = /^(\d+)(%?)$/.exec(img.getAttribute('width') ?? '');
  const height = /^(\d+)$/.exec(img.getAttribute('height') ?? '');
  const size: WrittenSize = {};
  if (width) {
    size.inlineSize = `${width[1]}${width[2] || 'px'}`;
  }
  if (width && !width[2] && height && Number(width[1]) > 0 && Number(height[1]) > 0) {
    size.aspectRatio = `${width[1]} / ${height[1]}`;
  } else if (!width && height) {
    size.blockSize = `${height[1]}px`;
  }
  return size;
}

/**
 * Gives the placeholder the image's size (IM-11). The stylesheet keeps it
 * within the preview's width.
 */
function reserveSize(placeholder: HTMLElement, img: HTMLImageElement): void {
  Object.assign(placeholder.style, writtenSize(img));
}
