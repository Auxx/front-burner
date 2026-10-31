import { afterNextRender, ChangeDetectionStrategy, Component, ElementRef, signal, viewChild } from '@angular/core';

/**
 * A horizontal separator between groups of content. With projected text, such
 * as "or", the text sits between two lines; without it, it is a single line.
 */
@Component({
  selector: 'ui-divider',
  templateUrl: './divider.component.html',
  styleUrl: './divider.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'separator' }
})
export class DividerComponent {
  private readonly text = viewChild.required<ElementRef<HTMLElement>>('text');

  protected readonly hasText = signal(false);

  constructor() {
    afterNextRender(() => this.hasText.set(!!this.text().nativeElement.textContent?.trim()));
  }
}
