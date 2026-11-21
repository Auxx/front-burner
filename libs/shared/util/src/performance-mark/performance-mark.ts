/**
 * The performance marks of the web client (A-8.17), which `perf-screen.mjs`
 * reads to time NF-2's screen targets:
 *
 * - `fb:app-ready`: the first route's page has rendered (NF-2.7);
 * - `fb:tree-folder-shown`: a folder's entries are on the page, with
 *   `{ folder }`, its path, `''` for the root (NF-2.1);
 * - `fb:editor-ready`: the editor shows a file and takes input (NF-2.2);
 * - `fb:preview-updated`: the preview shows a new render (NF-2.5).
 */
export type PerformanceMarkName = 'fb:app-ready' | 'fb:tree-folder-shown' | 'fb:editor-ready' | 'fb:preview-updated';

/**
 * Sets a performance mark, also in the production build; does nothing where
 * there is no User Timing API, such as in jsdom.
 */
export function markPerformance(name: PerformanceMarkName, detail?: unknown): void {
  if (typeof performance !== 'undefined' && typeof performance.mark === 'function') {
    performance.mark(name, detail === undefined ? undefined : { detail });
  }
}
