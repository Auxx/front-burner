/** What {@link keepScrollOffset} needs of a virtual scroll viewport, such as `CdkVirtualScrollViewport`. */
export interface ScrollOffsetViewport {
  readonly elementRef: { readonly nativeElement: HTMLElement; };
  scrollToOffset(offset: number): void;
}

/** Follows one viewport for {@link keepScrollOffset}. */
export interface KeptScrollOffset {
  /** Call on every resize of the viewport, from its `ResizeObserver`. */
  resized(): void;
  /** Stops following the viewport. */
  stop(): void;
}

/**
 * Keeps the scroll offset of `viewport` while it is hidden with
 * `display: none`, such as a tool window while the other is shown, and puts
 * it back when it is shown again: WebKit forgets it, as the viewport loses its
 * box. Chromium and Firefox keep it, and then nothing is done.
 */
export function keepScrollOffset(viewport: ScrollOffsetViewport): KeptScrollOffset {
  const element = viewport.elementRef.nativeElement;
  let offset = element.scrollTop;
  let hidden = false;
  // The scroll of a viewport shown again comes before its resize: it does not count.
  const onScroll = () => {
    if (!hidden) {
      offset = element.scrollTop;
    }
  };
  element.addEventListener('scroll', onScroll, { passive: true });
  return {
    resized: () => {
      if (element.getClientRects().length === 0) {
        hidden = true;
      } else if (hidden) {
        hidden = false;
        if (element.scrollTop !== offset) {
          viewport.scrollToOffset(offset);
        }
      }
    },
    stop: () => element.removeEventListener('scroll', onScroll)
  };
}
