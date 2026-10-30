import type { Subscription } from 'rxjs';

import type { ImageCache, ImageFailure, ImageResult } from './image-cache';
import { createPlaceholder, type PlaceholderContent, setPlaceholderContent } from './image-placeholder';
import { pickPictureSource } from './pick-source';
import { RemoteImages, type RemoteImagesTexts } from './remote-images';
import { type ImageTarget, resolveImageAddress } from './resolve-image';

/** Repository images within this distance of the preview's viewport are loaded (IM-8). */
export const IMAGE_LOAD_MARGIN = '200px';

/** The texts the loader shows (IM-14, IM-18). */
export interface ImageLoaderTexts extends RemoteImagesTexts {
  notFound(address: string): string;
  tooLarge: string;
  unsupported: string;
  refused: string;
  error: string;
  remote(host: string): string;
  remoteFailed: string;
  insecure: string;
}

export interface ImageLoaderOptions {
  /** The preview's scrolling element, whose viewport decides what loads. */
  root: HTMLElement;
  /** `null` where no repository screen provides one: repository images then cannot be loaded. */
  cache: ImageCache | null;
  repositoryId(): number | null;
  /** The open file's path, which relative addresses start from (IM-2). */
  filePath(): string;
  texts(): ImageLoaderTexts;
}

type SlotState = 'waiting' | 'loaded' | 'failed' | 'remote';

/** One image of the preview: an `<img>`, or a `<picture>` with its `<img>`. */
interface Slot {
  block: HTMLElement;
  img: HTMLImageElement;
  picture: HTMLPictureElement | null;
  /** The address picked, as written in the file. */
  address: string;
  target: ImageTarget;
  state: SlotState;
  placeholder: HTMLElement | null;
  /** Cancels a load that waits for its turn. */
  abort: AbortController | null;
  /** Releases the cached image this slot shows. */
  release: (() => void) | null;
  /** Revalidates the shown image once it is near the viewport, the first time since the file was opened. */
  check: boolean;
}

const FAILURES: Readonly<Record<ImageFailure, (texts: ImageLoaderTexts, address: string) => string>> = {
  'not-found': (texts, address) => texts.notFound(address),
  'too-large': texts => texts.tooLarge,
  unsupported: texts => texts.unsupported,
  refused: texts => texts.refused,
  error: texts => texts.error
};

/**
 * Shows the images of one preview (REQ-EDIT-003, A-8.16). DOMPurify's step
 * has moved every image address into a pipeline attribute (IM-24); this is
 * the only place that sets an image's address:
 *
 * - each image gets a placeholder of its size (IM-11, IM-20) until it can be
 *   shown, or for good with the reason it cannot (IM-18), inside its link if
 *   it has one (IM-19);
 * - repository images near the viewport are loaded through the `ImageCache`
 *   (IM-8, IM-10) and shown through `blob:` URLs (IM-6); one already cached
 *   is shown at once, so that a block rendered again while typing loads
 *   nothing, and is revalidated once near the viewport after the file was
 *   opened again;
 * - remote images wait for **Show remote images**, and load with no
 *   referrer (IM-13 to IM-17); `http:` ones never load;
 * - a `<picture>` shows the source a browser would pick, picked again when
 *   the colour scheme or the window size changes (IM-12).
 *
 * The preview calls `attach` with each new block and `detach` with each
 * removed one; a failed image is tried again when its block is rendered
 * again (IM-19).
 */
export class ImageLoader {
  private readonly slots = new Set<Slot>();
  private readonly byElement = new WeakMap<Element, Slot>();
  private readonly byBlock = new Map<HTMLElement, Slot[]>();
  private readonly observer: IntersectionObserver | null;
  private readonly mediaLists = new Map<string, MediaQueryList>();
  private readonly subscription: Subscription | undefined;
  private readonly repick = () => this.pickAgain();
  private readonly remote: RemoteImages;
  /** Repository images revalidated, or loaded, since the open file was opened. */
  private readonly checked = new Set<string>();

  constructor(private readonly options: ImageLoaderOptions) {
    const view = options.root.ownerDocument.defaultView;
    this.observer = view && 'IntersectionObserver' in view
      ? new view.IntersectionObserver(entries => this.intersected(entries), {
        root: options.root,
        rootMargin: IMAGE_LOAD_MARGIN
      })
      : null;
    view?.addEventListener('resize', this.repick);
    this.subscription = options.cache?.changed.subscribe(change => {
      if (change.repositoryId === options.repositoryId()) {
        this.changed(change.path, change.result);
      }
    });
    this.remote = new RemoteImages(() => options.texts(), () => this.showRemote());
  }

  /** Takes over the images of new blocks of the preview. */
  attach(blocks: readonly HTMLElement[]): void {
    for (const block of blocks) {
      const images = [
        ...Array.from(block.querySelectorAll('picture')),
        ...Array.from(block.querySelectorAll('img')).filter(img => !img.closest('picture'))
      ];
      const slots: Slot[] = [];
      for (const image of images) {
        const picture = image instanceof HTMLPictureElement ? image : null;
        const img = picture ? picture.querySelector('img') : image as HTMLImageElement;
        if (!img) {
          // A `<picture>` without its `<img>` shows nothing in a browser either.
          continue;
        }
        const slot: Slot = {
          block,
          img,
          picture,
          address: '',
          target: { kind: 'refused' },
          state: 'waiting',
          placeholder: null,
          abort: null,
          release: null,
          check: false
        };
        this.pick(slot);
        slots.push(slot);
        this.slots.add(slot);
        this.render(slot);
      }
      if (slots.length > 0) {
        this.byBlock.set(block, slots);
      }
    }
    this.placeRemoteButton();
  }

  /** Lets go of the images of removed blocks. */
  detach(blocks: readonly HTMLElement[]): void {
    for (const block of blocks) {
      for (const slot of this.byBlock.get(block) ?? []) {
        this.clear(slot);
        this.slots.delete(slot);
      }
      this.byBlock.delete(block);
    }
    this.placeRemoteButton();
  }

  /** Starts afresh for another file: remote images are hidden again, and cached images revalidated (IM-10, IM-15). */
  reset(): void {
    this.checked.clear();
    this.remote.reset();
  }

  /** Resolves every image again, as when the open file moved to another folder. */
  refresh(): void {
    for (const slot of this.slots) {
      this.pick(slot);
      this.render(slot);
    }
    this.placeRemoteButton();
  }

  destroy(): void {
    for (const slot of this.slots) {
      this.clear(slot);
    }
    this.slots.clear();
    this.byBlock.clear();
    this.observer?.disconnect();
    this.subscription?.unsubscribe();
    this.options.root.ownerDocument.defaultView?.removeEventListener('resize', this.repick);
    for (const list of this.mediaLists.values()) {
      list.removeEventListener('change', this.repick);
    }
    this.mediaLists.clear();
    this.remote.place(null);
  }

  /**
   * Reads the slot's address: its `<img>`'s, or the source its `<picture>`
   * picks, which starts following the media queries it reads.
   */
  private pick(slot: Slot): void {
    const imgAddress = slot.img.getAttribute('data-md-src');
    let address = imgAddress;
    if (slot.picture) {
      const view = slot.img.ownerDocument.defaultView;
      address = pickPictureSource({
        sources: Array.from(slot.picture.querySelectorAll('source')).map(source => ({
          media: source.getAttribute('media'),
          type: source.getAttribute('type'),
          srcset: source.getAttribute('data-md-srcset') ?? ''
        })),
        img: imgAddress
      }, {
        ratio: view?.devicePixelRatio || 1,
        width: this.options.root.clientWidth,
        matches: media => this.mediaList(media)?.matches ?? false
      });
    }
    slot.address = address ?? '';
    slot.target = resolveImageAddress(this.options.filePath(), slot.address);
  }

  /** Shows the slot as its target allows, after letting go of what it showed. */
  private render(slot: Slot): void {
    this.clear(slot);
    const texts = this.options.texts();
    const target = slot.target;
    switch (target.kind) {
      case 'refused':
        return this.fail(slot, { reason: texts.refused });
      case 'unsupported':
        return this.fail(slot, { reason: texts.unsupported });
      case 'insecure':
        return this.fail(slot, { reason: texts.insecure });
      case 'remote':
        if (this.remote.shown()) {
          return this.show(slot, target.url);
        }
        slot.state = 'remote';
        return this.placehold(slot, { reason: texts.remote(target.host) });
      case 'repository': {
        const cache = this.options.cache;
        const repositoryId = this.options.repositoryId();
        if (!cache || repositoryId === null) {
          return this.fail(slot, { reason: texts.error });
        }
        const url = cache.peek(repositoryId, target.path);
        if (url !== null) {
          slot.release = cache.use(repositoryId, target.path);
          slot.check = !this.checked.has(target.path);
          this.show(slot, url);
          return;
        }
        slot.state = 'waiting';
        this.placehold(slot, { reason: null });
      }
    }
  }

  private intersected(entries: readonly IntersectionObserverEntry[]): void {
    for (const entry of entries) {
      const slot = this.byElement.get(entry.target);
      if (!slot || !this.slots.has(slot) || slot.target.kind !== 'repository') {
        continue;
      }
      if (slot.state === 'loaded' && entry.isIntersecting) {
        this.observer?.unobserve(entry.target);
        this.revalidate(slot, slot.target.path);
      } else if (slot.state === 'waiting' && entry.isIntersecting && !slot.abort) {
        this.load(slot, slot.target.path);
      } else if (slot.state === 'waiting' && !entry.isIntersecting) {
        // Dropped from the queue if it has not started yet (IM-8).
        slot.abort?.abort();
        slot.abort = null;
      }
    }
  }

  private load(slot: Slot, path: string): void {
    const cache = this.options.cache;
    const repositoryId = this.options.repositoryId();
    if (!cache || repositoryId === null) {
      return;
    }
    const abort = new AbortController();
    slot.abort = abort;
    this.checked.add(path);
    cache.load(repositoryId, path, abort.signal).then(result => {
      if (slot.abort !== abort || !this.slots.has(slot)) {
        return;
      }
      slot.abort = null;
      this.loaded(slot, result);
    }, () => undefined);
  }

  private loaded(slot: Slot, result: ImageResult): void {
    const cache = this.options.cache;
    const repositoryId = this.options.repositoryId();
    if (result.kind === 'failed' || !cache || repositoryId === null || slot.target.kind !== 'repository') {
      const reason = result.kind === 'failed' ? result.reason : 'error';
      this.fail(slot, { reason: FAILURES[reason](this.options.texts(), slot.address) });
      return;
    }
    slot.release?.();
    slot.release = cache.use(repositoryId, slot.target.path);
    this.show(slot, result.url);
  }

  private revalidate(slot: Slot, path: string): void {
    slot.check = false;
    const repositoryId = this.options.repositoryId();
    if (this.checked.has(path) || repositoryId === null) {
      return;
    }
    this.checked.add(path);
    this.options.cache?.revalidate(repositoryId, [ path ]);
  }

  /** A cached image whose bytes changed, or that is gone (IM-10). */
  private changed(path: string, result: ImageResult): void {
    for (const slot of this.slots) {
      if (slot.target.kind === 'repository' && slot.target.path === path && slot.state !== 'waiting') {
        if (result.kind === 'loaded' && slot.state === 'loaded') {
          // The cache keeps counting this slot as a user of the new bytes.
          slot.img.src = result.url;
        } else {
          slot.release?.();
          slot.release = null;
          this.loaded(slot, result);
        }
      }
    }
  }

  /** Shows the image at `url` in its own place, instead of any placeholder. */
  private show(slot: Slot, url: string): void {
    const remote = slot.target.kind === 'remote';
    slot.state = 'loaded';
    const img = slot.img;
    if (remote) {
      // Before the address, so that the first request already has no referrer (IM-15).
      img.referrerPolicy = 'no-referrer';
    }
    img.onerror = () => {
      slot.release?.();
      slot.release = null;
      const texts = this.options.texts();
      const host = slot.target.kind === 'remote' ? slot.target.host : undefined;
      this.fail(slot, remote ? { reason: texts.remoteFailed, detail: host } : { reason: texts.error });
    };
    img.src = url;
    const host = slot.picture ?? img;
    if (slot.placeholder) {
      slot.placeholder.replaceWith(host);
      slot.placeholder = null;
    }
    if (slot.check) {
      this.byElement.set(host, slot);
      this.observer?.observe(host);
    }
  }

  private fail(slot: Slot, content: Omit<PlaceholderContent, 'alt'>): void {
    slot.state = 'failed';
    this.placehold(slot, content);
  }

  /** Puts a placeholder with `content` in the image's place, observed while it waits to load. */
  private placehold(slot: Slot, content: Omit<PlaceholderContent, 'alt'>): void {
    const host = slot.picture ?? slot.img;
    const full = { ...content, alt: slot.img.getAttribute('alt') ?? '' };
    slot.img.removeAttribute('src');
    slot.img.onerror = null;
    if (slot.placeholder) {
      setPlaceholderContent(slot.placeholder, full);
    } else {
      slot.placeholder = createPlaceholder(slot.img, full);
      host.replaceWith(slot.placeholder);
    }
    if (slot.state === 'waiting') {
      this.byElement.set(slot.placeholder, slot);
      if (this.observer) {
        this.observer.observe(slot.placeholder);
      } else if (slot.target.kind === 'repository') {
        // Without an observer, every image counts as near the viewport.
        this.load(slot, slot.target.path);
      }
    }
  }

  /** Lets go of a slot's load, cached image and observation, leaving whatever it shows. */
  private clear(slot: Slot): void {
    slot.abort?.abort();
    slot.abort = null;
    slot.release?.();
    slot.release = null;
    slot.check = false;
    if (slot.placeholder) {
      this.observer?.unobserve(slot.placeholder);
    }
    this.observer?.unobserve(slot.picture ?? slot.img);
  }

  private showRemote(): void {
    for (const slot of this.slots) {
      if (slot.target.kind === 'remote' && slot.state === 'remote') {
        this.show(slot, slot.target.url);
      }
    }
  }

  /** Puts **Show remote images** at the top of the first block, in file order, that holds a remote image (IM-14). */
  private placeRemoteButton(): void {
    let first: HTMLElement | null = null;
    for (const [ block, slots ] of this.byBlock) {
      if (
        slots.some(slot => slot.state === 'remote')
        && (first === null || first.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_PRECEDING)
      ) {
        first = block;
      }
    }
    this.remote.place(first);
  }

  private mediaList(media: string): MediaQueryList | null {
    let list = this.mediaLists.get(media);
    const view = this.options.root.ownerDocument.defaultView;
    if (!list && view && typeof view.matchMedia === 'function') {
      list = view.matchMedia(media);
      list.addEventListener('change', this.repick);
      this.mediaLists.set(media, list);
    }
    return list ?? null;
  }

  /** Picks every `<picture>`'s source again, and shows the ones whose pick changed (IM-12). */
  private pickAgain(): void {
    for (const slot of this.slots) {
      if (!slot.picture) {
        continue;
      }
      const before = slot.address;
      this.pick(slot);
      if (slot.address !== before) {
        this.render(slot);
      }
    }
    this.placeRemoteButton();
  }
}
