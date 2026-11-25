import { keepScrollOffset } from './kept-scroll-offset.util';

/** A viewport whose box comes and goes with `shown`, and whose scroll WebKit may reset. */
function fakeViewport() {
  const element = document.createElement('div');
  let shown = true;
  vi.spyOn(element, 'getClientRects').mockImplementation(() =>
    (shown ? [ new DOMRect(0, 0, 100, 100) ] : []) as unknown as DOMRectList
  );
  const scrollToOffset = vi.fn((offset: number) => scrollTo(offset));
  const scrollTo = (top: number) => {
    element.scrollTop = top;
    element.dispatchEvent(new Event('scroll'));
  };
  return {
    viewport: { elementRef: { nativeElement: element }, scrollToOffset },
    element,
    scrollTo,
    show: (value: boolean) => (shown = value)
  };
}

describe('keepScrollOffset', () => {
  it('puts back the offset that a viewport lost while hidden', () => {
    const { viewport, element, scrollTo, show } = fakeViewport();
    const kept = keepScrollOffset(viewport);
    scrollTo(1500);

    show(false);
    kept.resized();
    show(true);
    // What WebKit does when the box comes back, scroll event included.
    scrollTo(0);
    kept.resized();

    expect(viewport.scrollToOffset).toHaveBeenCalledWith(1500);
    expect(element.scrollTop).toBe(1500);
    kept.stop();
  });

  it('does nothing when the browser kept the offset', () => {
    const { viewport, scrollTo, show } = fakeViewport();
    const kept = keepScrollOffset(viewport);
    scrollTo(800);

    show(false);
    kept.resized();
    show(true);
    kept.resized();

    expect(viewport.scrollToOffset).not.toHaveBeenCalled();
    kept.stop();
  });

  it('does nothing on a resize while shown', () => {
    const { viewport, scrollTo } = fakeViewport();
    const kept = keepScrollOffset(viewport);
    scrollTo(300);
    scrollTo(0);

    kept.resized();

    expect(viewport.scrollToOffset).not.toHaveBeenCalled();
    kept.stop();
  });
});
