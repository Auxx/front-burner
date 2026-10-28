import { DefaultUrlSerializer, Route, UrlSegment, UrlSegmentGroup } from '@angular/router';

import { repositoryScreenMatcher } from './repository-screen-matcher';

/** The segments after `/repositories/12`, as the router decodes them. */
function segments(rest: string): UrlSegment[] {
  const tree = new DefaultUrlSerializer().parse(`/repositories/12${rest}`);
  return tree.root.children['primary'].segments.slice(2);
}

function match(rest: string) {
  const all = segments(rest);
  return repositoryScreenMatcher(all, new UrlSegmentGroup(all, {}), {} as Route);
}

describe('repositoryScreenMatcher', () => {
  it.each([
    [ '', '' ],
    [ '/files/docs/guide.md', 'docs/guide.md' ],
    [ '/files/caf%C3%A9.md', 'café.md' ],
    [ '/files/a%2Fb.md', 'a/b.md' ]
  ])('matches %j with the path %j', (rest, path) => {
    const result = match(rest);

    expect(result?.consumed).toHaveLength(segments(rest).length);
    expect(result?.posParams?.['path']?.path).toBe(path);
  });

  it.each([ '/files', '/settings', '/new', '/settings/files/a.md' ])('does not match %j', rest => {
    expect(match(rest)).toBeNull();
  });
});
