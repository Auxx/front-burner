import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  type ElementRef,
  inject,
  input,
  linkedSignal,
  output,
  untracked,
  viewChild
} from '@angular/core';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';

import { ImageCache } from '../../images/image-cache';
import { ImageLoader, type ImageLoaderTexts } from '../../images/image-loader';
import { purifyHtml } from '../../purify/purify-html';
import { PreviewRendererService, type PreviewSource } from '../../services/preview-renderer/preview-renderer.service';
import { RemovalNoticeComponent } from '../removal-notice/removal-notice.component';
import { findById, patchBlocks } from './patch-blocks';
import { scrollTopOf, topPlace } from './preview-lines';
import { resolvePreviewLink } from './preview-links';

/** A link of the preview to another entry of the repository (ED-31). */
export interface PreviewPathLink {
  path: string;
  /** The heading to scroll to, without the `user-content-` prefix as written in the link. */
  fragment: string | null;
  /** Whether the user asked for a new tab: a middle click, or a click with Ctrl, Cmd or Shift. */
  newTab: boolean;
}

/** What the preview's images are resolved for. */
interface ImagesFor {
  source: PreviewSource;
  path: string;
  repositoryId: number | null;
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
 *
 * Places in the file are fractional lines (`preview-lines.ts`): `topLine`
 * reads the place at the top, `scrollToLine` scrolls to one, and `scrolled`
 * reports the new place after each scroll that the preview did not make
 * itself, so that a pane that follows it never makes it follow back (ED-35,
 * ED-36). While `active` is false, such as on a hidden tab, the preview
 * neither reads the text nor renders (A-8.12).
 *
 * Images are shown by an `ImageLoader` (A-8.16) from the `ImageCache` that
 * the repository screen provides, for the repository `repositoryId`.
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
  /** Whether the preview is on screen; while it is not, it does no work (A-8.12). */
  readonly active = input(true);
  /** The repository whose images the preview shows (A-8.16). */
  readonly repositoryId = input<number | null>(null);

  readonly openPath = output<PreviewPathLink>();
  /** The place at the top after a scroll the preview did not make itself. */
  readonly scrolled = output<number>();

  private readonly blocks = viewChild<ElementRef<HTMLElement>>('blocks');
  private readonly renderer = inject(PreviewRendererService);
  private readonly transloco = inject(TranslocoService);
  private readonly imageCache = inject(ImageCache, { optional: true });
  private imageLoader: ImageLoader | null = null;
  /** What the images were last resolved for: another source is another file, another path moves it. */
  private imagesFor: ImagesFor | null = null;
  protected readonly state = this.renderer.connect(this.source, this.active);
  /** **Hide** on the removal notice lasts until another file is opened (SH-19). */
  protected readonly noticeHidden = linkedSignal({ source: this.source, computation: () => false });
  /** The fragment already scrolled to, with its source; forgotten when the screen has none. */
  private fragmentShown: { source: PreviewSource; fragment: string; } | null = null;
  /** The `scrollTop` the preview last set, until its scroll event comes. */
  private ownScrollTop: number | null = null;
  /** A place to scroll to again once the newest text is shown. */
  private pendingPlace: number | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.imageLoader?.destroy());
    effect(() => {
      const state = this.state();
      const container = this.blocks()?.nativeElement;
      this.fragment();
      const images = { source: this.source(), path: this.path(), repositoryId: this.repositoryId() };
      if (!container) {
        return;
      }
      const loader = untracked(() => this.loaderFor(container, images));
      if (!state) {
        untracked(() => loader.detach(Array.from(container.children) as HTMLElement[]));
        container.replaceChildren();
        return;
      }
      const changes = patchBlocks(container, state, purifyHtml);
      untracked(() => {
        loader.detach(changes.removed);
        loader.attach(changes.added);
        this.scrollToFragment(container);
        if (this.pendingPlace !== null) {
          this.scrollToLine(this.pendingPlace);
        }
      });
    });
  }

  /**
   * The image loader, created with the preview's container, and told when
   * another file is opened (IM-10, IM-15) or the open file moved.
   */
  private loaderFor(container: HTMLElement, images: ImagesFor): ImageLoader {
    this.imageLoader ??= new ImageLoader({
      root: container,
      cache: this.imageCache,
      repositoryId: () => this.imagesFor?.repositoryId ?? null,
      filePath: () => this.imagesFor?.path ?? '',
      texts: () => this.imageTexts()
    });
    const before = this.imagesFor;
    this.imagesFor = images;
    if (!before || before.source !== images.source) {
      this.imageLoader.reset();
    } else if (before.path !== images.path || before.repositoryId !== images.repositoryId) {
      this.imageLoader.refresh();
    }
    return this.imageLoader;
  }

  private imageTexts(): ImageLoaderTexts {
    const t = (key: string, params?: Record<string, string>) =>
      this.transloco.translate(`web-markdown.MarkdownPreviewComponent.images.${key}`, params);
    return {
      notFound: address => t('notFound', { address }),
      tooLarge: t('tooLarge'),
      unsupported: t('unsupported'),
      refused: t('refused'),
      error: t('error'),
      remote: host => t('remote', { host }),
      remoteFailed: t('remoteFailed'),
      insecure: t('insecure'),
      button: t('showRemote'),
      note: t('remoteNote')
    };
  }

  /** The place at the top of the preview; `1` while it shows nothing. */
  topLine(): number {
    const container = this.blocks()?.nativeElement;
    return container ? topPlace(container) : 1;
  }

  /**
   * Scrolls `place` to the top. While the preview shows nothing yet, or newer
   * text is waiting or rendering, such as right after the preview becomes
   * active, it scrolls there again once that text is shown, unless the user
   * scrolls first.
   */
  scrollToLine(place: number): void {
    const container = this.blocks()?.nativeElement;
    this.pendingPlace = this.renderer.busy() || untracked(this.state) === null ? place : null;
    const top = container ? scrollTopOf(container, place) : null;
    if (!container || top === null) {
      return;
    }
    const before = container.scrollTop;
    container.scrollTop = top;
    // The browser rounds and clamps, and fires a scroll event only when the preview moved.
    this.ownScrollTop = container.scrollTop === before ? null : container.scrollTop;
  }

  protected onScroll(): void {
    const container = this.blocks()?.nativeElement;
    if (!container) {
      return;
    }
    if (this.ownScrollTop !== null && Math.abs(container.scrollTop - this.ownScrollTop) <= 1) {
      this.ownScrollTop = null;
      return;
    }
    this.ownScrollTop = null;
    this.pendingPlace = null;
    this.scrolled.emit(topPlace(container));
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
      this.fragmentShown = null;
      return;
    }
    if (this.fragmentShown?.source === source && this.fragmentShown.fragment === fragment) {
      return;
    }
    const target = findById(container, fragment);
    if (target) {
      this.fragmentShown = { source, fragment };
      target.scrollIntoView?.();
    }
  }
}
