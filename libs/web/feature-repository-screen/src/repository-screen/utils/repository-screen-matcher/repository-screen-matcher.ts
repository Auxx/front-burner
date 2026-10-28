import { UrlMatcher, UrlSegment } from '@angular/router';

/**
 * The repository screen's URLs below `/repositories/<id>` (FB-1): none, or
 * `files/<path>` with at least one segment of path. One route for both keeps
 * the page, and so the opened repository, when only the open file changes
 * (FB-11). `posParams.path` is the decoded path, or `''`.
 */
export const repositoryScreenMatcher: UrlMatcher = (segments: UrlSegment[]) => {
  if (segments.length === 0) {
    return { consumed: [], posParams: { path: new UrlSegment('', {}) } };
  }
  if (segments[0].path !== 'files' || segments.length < 2) {
    return null;
  }
  const path = segments.slice(1).map(segment => segment.path).join('/');
  return { consumed: segments, posParams: { path: new UrlSegment(path, {}) } };
};
