import { DOCUMENT } from '@angular/common';
import { CSP_NONCE, inject, Injectable } from '@angular/core';

/** The groups of lazy chunks the web client preloads itself (A-8.18). */
export type ClientChunkGroup = 'editor';

/**
 * Preloads a group of lazy chunks before the code that imports them runs
 * (A-8.18): adds a `<link rel="modulepreload">` per file of the group, with
 * the page's CSP nonce, so that a chunk and all its static imports arrive in
 * one round trip instead of one per level of imports (NF-2.2). The files come
 * from the `#fb-chunk-map` the server writes into `index.html` (A-7.9);
 * without one, as under `ng serve`, it does nothing.
 */
@Injectable({ providedIn: 'root' })
export class ChunkPreloaderService {
  private readonly document = inject(DOCUMENT);
  private readonly nonce = inject(CSP_NONCE, { optional: true });
  private groups: Partial<Record<ClientChunkGroup, readonly string[]>> | undefined;

  /** Starts loading the files of `group` that are not preloaded yet. */
  preload(group: ClientChunkGroup): void {
    const head = this.document.head;
    for (const file of this.map()[group] ?? []) {
      const known = [ ...head.querySelectorAll('link[rel="modulepreload"]') ].some(link =>
        link.getAttribute('href') === file
      );
      if (known) {
        continue;
      }
      const link = this.document.createElement('link');
      link.rel = 'modulepreload';
      link.setAttribute('href', file);
      if (this.nonce) {
        // The attribute, not only the property: the browser checks either, and `[nonce]` then finds the link.
        link.setAttribute('nonce', this.nonce);
      }
      head.append(link);
    }
  }

  /** The map, read once; empty when it is missing or not a map of file lists. */
  private map(): Partial<Record<ClientChunkGroup, readonly string[]>> {
    if (this.groups === undefined) {
      this.groups = {};
      try {
        const parsed: unknown = JSON.parse(this.document.getElementById('fb-chunk-map')?.textContent ?? '{}');
        if (typeof parsed === 'object' && parsed !== null) {
          for (const [ group, files ] of Object.entries(parsed)) {
            if (Array.isArray(files) && files.every(file => typeof file === 'string')) {
              this.groups[group as ClientChunkGroup] = files;
            }
          }
        }
      } catch {
        // No preloads: the chunks load as they are imported.
      }
    }
    return this.groups;
  }
}
