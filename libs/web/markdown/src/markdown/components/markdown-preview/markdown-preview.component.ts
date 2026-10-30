import {
  ChangeDetectionStrategy,
  Component,
  effect,
  type ElementRef,
  inject,
  input,
  linkedSignal,
  output,
  untracked,
  viewChild
} from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';

import { purifyHtml } from '../../purify/purify-html';
import { PreviewRendererService, type PreviewSource } from '../../services/preview-renderer/preview-renderer.service';
import { RemovalNoticeComponent } from '../removal-notice/removal-notice.component';
import { findById, patchBlocks } from './patch-blocks';
import { resolvePreviewLink } from './preview-links';

/** A link of the preview to another entry of the repository (ED-31). */
export interface PreviewPathLink {
  path: string;
  /** The heading to scroll to, without the `user-content-` prefix as written in the link. */
  fragment: string | null;
  /** Whether the user asked for a new tab: a middle click, or a click with Ctrl, Cmd or Shift. */
  newTab: boolean;
}

/**
 * The live preview of the open file (ED-26 to ED-33): a region labelled
 * "Preview of <file name>" (ED-37) with the removal notice at its top
 * (SH-17) and one element per block of the file (A-8.12).
 *
 * It is the only component of the web client that writes HTML into the page
 * (D-7.6): DOMPurify runs on new blocks only, and blocks already shown keep
 * their elements, so typing in one paragraph leaves the rest untouched.
 *
 * Links (ED-31): `http:`, `https:` and `mailto:` open in a new tab; `#name`
 * scrolls to the heading; any other link is a path in the repository,
 * emitted as `openPath` for the screen to open like a tree selection, or in
 * a new tab after a middle click or a click with Ctrl, Cmd or Shift; a link
 * to a heading of the open file itself just scrolls. A `fragment` given with
 * the file scrolls to that heading once it is shown.
 *
 * While another file is being rendered, the preview is empty, so that no
 * block or link of the previous file is shown under the new file's name.
 */
@Component({
  selector: 'md-preview',
  imports: [ TranslocoDirective, RemovalNoticeComponent ],
  templateUrl: './markdown-preview.component.html',
  styleUrl: './markdown-preview.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [ PreviewRendererService ],
  // Links are followed by one delegated handler; a link is reached and activated with the keyboard as usual.
  host: { '(click)': 'clicked($event)', '(auxclick)': 'clicked($event)' }
})
export class MarkdownPreviewComponent {
  /** The text of the open file; another source is another file. */
  readonly source = input.required<PreviewSource>();
  /** The open file's path, which relative links start from. */
  readonly path = input('');
  /** The open file's name, which labels the region. */
  readonly label = input('');
  /** A heading to scroll to once it is shown, such as from a link in another file. */
  readonly fragment = input<string | null>(null);

  readonly openPath = output<PreviewPathLink>();

  private readonly blocks = viewChild<ElementRef<HTMLElement>>('blocks');
  protected readonly state = inject(PreviewRendererService).connect(this.source);
  /** **Hide** on the removal notice lasts until another file is opened (SH-19). */
  protected readonly noticeHidden = linkedSignal({ source: this.source, computation: () => false });
  /** The fragment already scrolled to, with its source; forgotten when the screen has none. */
  private scrolled: { source: PreviewSource; fragment: string; } | null = null;

  constructor() {
    effect(() => {
      const state = this.state();
      const container = this.blocks()?.nativeElement;
      this.fragment();
      if (!container) {
        return;
      }
      if (!state) {
        container.replaceChildren();
        return;
      }
      patchBlocks(container, state, purifyHtml);
      untracked(() => this.scrollToFragment(container));
    });
  }

  /**
   * Follows a link: `click` for the main button, `auxclick` for the others,
   * of which only the middle one opens a link. The browser's own navigation
   * is kept only for external links, which have their own `target`.
   */
  protected clicked(event: MouseEvent): void {
    const container = this.blocks()?.nativeElement;
    const link = (event.target as Element | null)?.closest('a[href]');
    if (!container || !link || !container.contains(link) || (event.type === 'auxclick' && event.button !== 1)) {
      return;
    }
    const target = resolvePreviewLink(this.path(), link.getAttribute('href') ?? '');
    if (target.kind === 'external') {
      return;
    }
    event.preventDefault();
    const newTab = event.button === 1 || event.ctrlKey || event.metaKey || event.shiftKey;
    if (target.kind === 'path' && (newTab || target.path !== this.path())) {
      this.openPath.emit({ path: target.path, fragment: target.fragment, newTab });
      return;
    }
    const id = target.kind === 'fragment' ? target.id : target.kind === 'path' ? target.fragment : null;
    if (id) {
      findById(container, id)?.scrollIntoView?.();
    }
  }

  private scrollToFragment(container: HTMLElement): void {
    const fragment = this.fragment();
    const source = this.source();
    if (!fragment) {
      this.scrolled = null;
      return;
    }
    if (this.scrolled?.source === source && this.scrolled.fragment === fragment) {
      return;
    }
    const target = findById(container, fragment);
    if (target) {
      this.scrolled = { source, fragment };
      target.scrollIntoView?.();
    }
  }
}
