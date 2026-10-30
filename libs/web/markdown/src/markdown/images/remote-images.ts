import { signal } from '@angular/core';

/** The texts of **Show remote images** (IM-14). */
export interface RemoteImagesTexts {
  button: string;
  note: string;
}

/** The class of the element that holds **Show remote images** and its note. */
export const REMOTE_IMAGES_CLASS = 'md-remote-images';

/**
 * **Show remote images** of one preview (IM-13 to IM-15): one button, with a
 * note on what loading remote images tells their hosts, at the top of the
 * first block that holds a remote image. The choice lasts until another file
 * is opened (`reset`); it is never remembered.
 */
export class RemoteImages {
  private readonly state = signal(false);
  /** Whether the user chose to show the open file's remote images. */
  readonly shown = this.state.asReadonly();
  private element: HTMLElement | null = null;

  constructor(
    private readonly texts: () => RemoteImagesTexts,
    private readonly onShow: () => void
  ) {}

  /** Shows the open file's remote images, and removes the button. */
  show(): void {
    const focused = this.element?.contains(this.element.ownerDocument.activeElement) ?? false;
    const block = this.element?.parentElement ?? null;
    this.element?.remove();
    this.element = null;
    this.state.set(true);
    this.onShow();
    // The button is gone; the keyboard stays where it was.
    if (focused) {
      block?.closest<HTMLElement>('[tabindex]')?.focus();
    }
  }

  /** Forgets the choice, as when another file is opened. */
  reset(): void {
    this.state.set(false);
  }

  /** Puts the button at the top of `block`, or removes it when there is none or the images are shown. */
  place(block: HTMLElement | null): void {
    if (block === null || this.shown()) {
      this.element?.remove();
      this.element = null;
      return;
    }
    this.element ??= this.create(block.ownerDocument);
    if (block.firstChild !== this.element) {
      block.prepend(this.element);
    }
  }

  private create(document: Document): HTMLElement {
    const texts = this.texts();
    const element = document.createElement('div');
    element.className = REMOTE_IMAGES_CLASS;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `${REMOTE_IMAGES_CLASS}__button`;
    button.textContent = texts.button;
    button.addEventListener('click', () => this.show());
    const note = document.createElement('span');
    note.className = `${REMOTE_IMAGES_CLASS}__note`;
    note.textContent = texts.note;
    element.append(button, note);
    return element;
  }
}
