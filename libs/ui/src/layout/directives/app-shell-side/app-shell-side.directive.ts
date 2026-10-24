import { Directive, ElementRef, inject, input } from '@angular/core';

/**
 * Marks the side panel of an app shell, such as the file tree. It is a drawer
 * on narrow screens, which takes the focus when it opens.
 */
@Directive({
  selector: '[uiAppShellSide]',
  host: {
    tabindex: '-1'
  }
})
export class AppShellSideDirective {
  /** The accessible name of the separator beside it, such as "Resize file tree". */
  readonly resizeLabel = input.required<string>();

  readonly element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
}
