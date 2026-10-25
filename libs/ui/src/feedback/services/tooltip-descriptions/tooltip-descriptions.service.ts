import { DOCUMENT, inject, Injectable } from '@angular/core';

let nextId = 0;

/** A text that describes an element, and how to change or remove it. */
export interface TooltipDescription {
  readonly id: string;
  update(text: string): void;
  remove(): void;
}

/**
 * Keeps the texts of tooltips in one hidden container in `<body>`, so that a
 * host's `aria-describedby` points at its text from the start, before its
 * tooltip is ever shown.
 */
@Injectable({ providedIn: 'root' })
export class TooltipDescriptionsService {
  private readonly document = inject(DOCUMENT);
  private container?: HTMLElement;

  add(text: string): TooltipDescription {
    if (!this.container) {
      this.container = this.document.createElement('div');
      this.container.hidden = true;
      this.document.body.append(this.container);
    }

    const element = this.document.createElement('span');
    element.id = `ui-tooltip-description-${nextId++}`;
    element.textContent = text;
    this.container.append(element);

    return {
      id: element.id,
      update: (newText: string) => (element.textContent = newText),
      remove: () => element.remove()
    };
  }
}
