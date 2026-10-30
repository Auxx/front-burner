/** A pane that scroll syncing moves: the editor or the preview. */
export interface ScrollPane {
  /** The element that holds the pane, which the user scrolls with the wheel, touch, keys or the scroll bar. */
  readonly element: HTMLElement;
  /** Scrolls the place (a fractional line of the file) to the top. */
  scrollToLine(place: number): void;
}

/** What the user does to scroll a pane, or to type in it, which may scroll it too. */
const LEAD_EVENTS = [ 'wheel', 'touchstart', 'pointerdown', 'keydown' ] as const;

/**
 * Scrolls the editor and the preview together in **Split** mode (ED-35). A
 * scroll of one brings the same place of the file to the top of the other:
 * the same block, and the same share of it.
 *
 * Only the pane the user last scrolled, touched, clicked or typed in leads.
 * The scrolls that syncing causes in the other pane, which come
 * asynchronously and keep coming while a scroll on a phone glides, are
 * ignored, so a scroll never syncs back.
 */
export class ScrollSync {
  private panes: readonly [ ScrollPane, ScrollPane ] | null = null;
  private leader: ScrollPane | null = null;

  /** Syncs the two panes until the returned function is called. */
  connect(editor: ScrollPane, preview: ScrollPane): () => void {
    const panes = [ editor, preview ] as const;
    this.panes = panes;
    this.leader = null;
    const listeners = panes.map(pane => {
      const lead = () => this.leader = pane;
      for (const type of LEAD_EVENTS) {
        pane.element.addEventListener(type, lead, { capture: true, passive: true });
      }
      return () => {
        for (const type of LEAD_EVENTS) {
          pane.element.removeEventListener(type, lead, { capture: true });
        }
      };
    });
    return () => {
      listeners.forEach(remove => remove());
      if (this.panes === panes) {
        this.panes = null;
        this.leader = null;
      }
    };
  }

  /** Reports a scroll of `pane` to `place`; it moves the other pane if `pane` leads. */
  scrolled(pane: ScrollPane, place: number): void {
    if (!this.panes || pane !== this.leader) {
      return;
    }
    const other = this.panes[0] === pane ? this.panes[1] : this.panes[0];
    other.scrollToLine(place);
  }
}
