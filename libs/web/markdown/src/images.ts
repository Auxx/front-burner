// The repository screen's image cache (A-8.16). It is an entry point of its own
// (`@front-burner/web-markdown/images`) so that the screen, which provides it,
// does not reach the main entry point: the preview and its pipeline stay in
// the editor's deferred chunk (ED-4).
export { ImageCache, type ImageChange, type ImageFailure, type ImageResult } from './markdown/images/image-cache';
