import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import type { DiffLine, GitChangeState, GitDiff, GitStatus } from '@front-burner/shared-contracts';
import { GitApi } from '@front-burner/web-api-client';
import { type Observable, of, Subject, throwError } from 'rxjs';

import { settle } from '../../../testing/settle';
import { translocoTesting } from '../../../testing/transloco-testing';
import { GitStatusStore } from '../../services/git-status-store/git-status-store.service';
import { DiffViewComponent } from './diff-view.component';

const KEY = 'web-feature-repository-screen.DiffViewComponent';

const STATUS: GitStatus = {
  branch: 'main',
  noCommits: false,
  lastCommit: null,
  upstream: null,
  upstreamGone: false,
  ahead: 0,
  behind: 0,
  changes: [ 'README.md', 'a.md', 'b.md', 'logo.png' ].map(path => ({ path, state: 'modified' as const })),
  mergeInProgress: false,
  networkJob: null
};

function context(count: number, from = 1): DiffLine[] {
  return Array.from({ length: count }, (_, index) => ({
    type: 'context' as const,
    oldLine: from + index,
    newLine: from + index,
    text: `line ${from + index}`
  }));
}

const textDiff = (lines: DiffLine[], extra: Partial<GitDiff & { kind: 'text'; }> = {}): GitDiff => ({
  kind: 'text',
  lines,
  complete: true,
  lineEndingsOnly: false,
  ...extra
});

const CHANGED: DiffLine[] = [
  { type: 'context', oldLine: 1, newLine: 1, text: '# Title' },
  { type: 'removed', oldLine: 2, newLine: null, text: 'the quick fox' },
  { type: 'added', oldLine: null, newLine: 2, text: 'the slow fox' }
];

describe('DiffViewComponent', () => {
  let diff: ReturnType<typeof vi.fn<(id: number, query: { path: string; }) => Observable<GitDiff>>>;
  let status: ReturnType<typeof signal<GitStatus | null>>;
  let fixture: ComponentFixture<DiffViewComponent>;

  const host = () => fixture.nativeElement as HTMLElement;
  const text = () => host().textContent ?? '';
  const rows = () => [ ...host().querySelectorAll('.row') ];
  const button = (name: string) =>
    [ ...host().querySelectorAll('button') ].find(item => item.textContent?.includes(name)) as
      | HTMLButtonElement
      | undefined;

  async function render(
    path = 'README.md',
    state: GitChangeState = 'modified',
    texts: Record<string, string> = {}
  ): Promise<void> {
    TestBed.configureTestingModule({
      imports: [ DiffViewComponent, translocoTesting(texts) ],
      providers: [
        { provide: GitApi, useValue: { diff } },
        { provide: GitStatusStore, useValue: { status } }
      ]
    });
    fixture = TestBed.createComponent(DiffViewComponent);
    fixture.componentRef.setInput('repositoryId', 12);
    fixture.componentRef.setInput('path', path);
    fixture.componentRef.setInput('state', state);
    await settle(fixture);
  }

  beforeEach(() => {
    diff = vi.fn(() => of(textDiff(CHANGED)));
    status = signal<GitStatus | null>(STATUS);
  });

  it('AC-GIT-002.3: shows a unified diff with changed words highlighted, and Open in editor opens the file', async () => {
    await render();
    const opened: string[] = [];
    fixture.componentInstance.openInEditor.subscribe(path => opened.push(path));

    expect(diff).toHaveBeenCalledWith(12, { path: 'README.md' });
    const [ same, removed, added ] = rows();
    expect(same.querySelector('.old')?.textContent).toBe('1');
    expect(same.querySelector('.new')?.textContent).toBe('1');
    expect(removed.querySelector('.old')?.textContent).toBe('2');
    expect(removed.querySelector('.new')?.textContent).toBe('');
    expect(removed.querySelector('.sign')?.textContent).toBe('-');
    expect(removed.querySelector('mark')?.textContent).toBe('quick');
    expect(added.querySelector('.old')?.textContent).toBe('');
    expect(added.querySelector('.new')?.textContent).toBe('2');
    expect(added.querySelector('.sign')?.textContent).toBe('+');
    expect(added.querySelector('mark')?.textContent).toBe('slow');
    expect(added.querySelector('.text')?.textContent).toBe('the slow fox');

    button(`${KEY}.openInEditor`)?.click();

    expect(opened).toEqual([ 'README.md' ]);
  });

  it('AC-GIT-002.3: shows Binary file changed with both sizes', async () => {
    diff.mockReturnValue(of({ kind: 'binary', oldSize: 512, newSize: 2048 }));
    await render('logo.png', 'modified', { [`${KEY}.binarySizes`]: '{{ old }} to {{ new }}' });

    expect(text()).toContain(`${KEY}.binary`);
    expect(text()).toContain('512 B to 2 KB');
    expect(rows()).toEqual([]);
  });

  it('says that a side of a binary file does not exist', async () => {
    diff.mockReturnValue(of({ kind: 'binary', oldSize: null, newSize: 1_572_864 }));
    await render('logo.png', 'added', {
      [`${KEY}.binarySizes`]: '{{ old }} to {{ new }}',
      [`${KEY}.noFile`]: 'no file'
    });

    expect(text()).toContain('no file to 1.5 MB');
  });

  it('AC-GIT-002.22: says This diff is too large to show', async () => {
    diff.mockReturnValue(of({ kind: 'too-large' }));
    await render();

    expect(text()).toContain(`${KEY}.tooLarge`);
    expect(rows()).toEqual([]);
  });

  it('AC-GIT-002.22: says when only the line endings changed', async () => {
    diff.mockReturnValue(of(textDiff([
      { type: 'removed', oldLine: 1, newLine: null, text: 'text\r' },
      { type: 'added', oldLine: null, newLine: 1, text: 'text' }
    ], { lineEndingsOnly: true })));
    await render();

    expect(text()).toContain(`${KEY}.lineEndingsOnly`);
    // The change itself shows too (GA-16).
    expect(rows()[0].querySelector('mark')?.textContent).toBe('␍');
  });

  it.each<[ string, GitChangeState ]>([
    [ 'README.md', 'deleted' ],
    [ 'logo.png', 'modified' ]
  ])('does not offer Open in editor for a deleted file or a non-Markdown file: %s, %s', async (path, state) => {
    await render(path, state);

    expect(button(`${KEY}.openInEditor`)).toBeUndefined();
  });

  it('opens a fold in place', async () => {
    diff.mockReturnValue(of(textDiff(context(50))));
    await render();
    expect(rows()).toHaveLength(6);

    button(`${KEY}.showMore`)?.click();
    await settle(fixture);

    expect(rows()).toHaveLength(50);
    expect(button(`${KEY}.showMore`)).toBeUndefined();
    expect(rows().map(row => row.querySelector('.old')?.textContent)).toEqual(
      Array.from({ length: 50 }, (_, index) => String(index + 1))
    );
  });

  it('says how many lines a fold hides', async () => {
    diff.mockReturnValue(of(textDiff(context(48))));
    await render('README.md', 'modified', { [`${KEY}.showMore`]: 'Show {{ count }} more lines' });

    expect(button('Show 42 more lines')).toBeDefined();
  });

  it('does not offer to open a fold when the diff is not complete', async () => {
    diff.mockReturnValue(of(textDiff([ ...context(2), ...context(2, 90) ], { complete: false })));
    await render();

    expect(button(`${KEY}.showMore`)).toBeUndefined();
    expect(host().querySelector('.fold')?.textContent).toContain(`${KEY}.notShown`);
  });

  it('shows HTML in a line as text', async () => {
    const markup = '<img src=x onerror="alert(1)">';
    diff.mockReturnValue(of(textDiff([ { type: 'added', oldLine: null, newLine: 1, text: markup } ])));
    await render('README.md', 'added');

    expect(host().querySelector('img')).toBeNull();
    expect(rows()[0].querySelector('.text')?.textContent).toBe(markup);
  });

  it('scrolls long lines inside the diff', async () => {
    await render();

    const scroller = host().querySelector('.scroller') as HTMLElement;
    // A keyboard user can scroll it too (GA-6).
    expect(scroller.getAttribute('tabindex')).toBe('0');
    expect(scroller.getAttribute('role')).toBe('region');
    expect(scroller.getAttribute('aria-label')).toBe(`${KEY}.label`);
    // Unit tests run without styles: the end-to-end run at 320 px checks that the page does not scroll.
    expect(scroller.contains(rows()[0])).toBe(true);
  });

  it('reloads the diff on git.changed and says when there are no more changes', async () => {
    await render();
    expect(diff).toHaveBeenCalledTimes(1);

    // `GitStatusStore` reads the status at once on `git.changed`.
    diff.mockReturnValue(of(textDiff([])));
    status.set({ ...STATUS, changes: [] });
    await settle(fixture);

    expect(diff).toHaveBeenCalledTimes(2);
    expect(rows()).toEqual([]);
    expect(text()).toContain(`${KEY}.noChanges`);
  });

  it('keeps the lines shown while a newer read runs, and folds that were opened', async () => {
    diff.mockReturnValue(of(textDiff(context(50))));
    await render();
    button(`${KEY}.showMore`)?.click();
    await settle(fixture);

    const answer = new Subject<GitDiff>();
    diff.mockReturnValue(answer);
    status.set({ ...STATUS });
    await settle(fixture);
    expect(rows()).toHaveLength(50);

    answer.next(textDiff(context(50)));
    await settle(fixture);
    expect(rows()).toHaveLength(50);
  });

  it('shows the diff of the last selection', async () => {
    const first = new Subject<GitDiff>();
    const second = new Subject<GitDiff>();
    diff.mockImplementation((_id, { path }) => path === 'a.md' ? first : second);
    await render('a.md');

    fixture.componentRef.setInput('path', 'b.md');
    await settle(fixture);
    // The first one's lines never show for the second one's name.
    second.next(textDiff([ { type: 'added', oldLine: null, newLine: 1, text: 'from b' } ]));
    first.next(textDiff([ { type: 'added', oldLine: null, newLine: 1, text: 'from a' } ]));
    await settle(fixture);

    expect(rows().map(row => row.querySelector('.text')?.textContent)).toEqual([ 'from b' ]);
  });

  it('shows nothing of the previous file while another one loads', async () => {
    await render('a.md');
    diff.mockReturnValue(new Subject<GitDiff>());

    fixture.componentRef.setInput('path', 'b.md');
    await settle(fixture);

    expect(rows()).toEqual([]);
    expect(host().querySelector('ui-spinner')).not.toBeNull();
  });

  it('says an added or deleted file is empty, while the status still lists it', async () => {
    diff.mockReturnValue(of(textDiff([])));
    await render('README.md', 'added');

    expect(text()).toContain(`${KEY}.emptyFile`);
    expect(text()).not.toContain(`${KEY}.noChanges`);
  });

  it('says the content has not changed for a modified file without lines, such as a new file mode', async () => {
    diff.mockReturnValue(of(textDiff([])));
    await render();

    expect(text()).toContain(`${KEY}.noContentChanges`);
    expect(text()).not.toContain(`${KEY}.noChanges`);
  });

  it('does not offer Open in editor once the status no longer lists the file', async () => {
    await render();
    expect(button(`${KEY}.openInEditor`)).toBeDefined();

    status.set({ ...STATUS, changes: [] });
    await settle(fixture);

    expect(button(`${KEY}.openInEditor`)).toBeUndefined();
  });

  it('does not rebuild the rows when a new read answers the same diff', async () => {
    await render();
    const component = fixture.componentInstance;
    const before = component['rows']();

    status.set({ ...STATUS });
    await settle(fixture);

    expect(diff).toHaveBeenCalledTimes(2);
    expect(component['rows']()).toBe(before);
  });

  it('does not show one file\'s failure on another file that is still loaded', async () => {
    await render('a.md');

    diff.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
    fixture.componentRef.setInput('path', 'b.md');
    await settle(fixture);
    expect(text()).toContain(`${KEY}.failed`);

    diff.mockReturnValue(new Subject<GitDiff>());
    fixture.componentRef.setInput('path', 'a.md');
    await settle(fixture);

    expect(text()).not.toContain(`${KEY}.failed`);
    expect(rows()).toHaveLength(3);
  });

  it('waits for the go-ahead before it reads, and shows that it is loading', async () => {
    TestBed.configureTestingModule({
      imports: [ DiffViewComponent, translocoTesting() ],
      providers: [
        { provide: GitApi, useValue: { diff } },
        { provide: GitStatusStore, useValue: { status } }
      ]
    });
    fixture = TestBed.createComponent(DiffViewComponent);
    fixture.componentRef.setInput('repositoryId', 12);
    fixture.componentRef.setInput('path', 'README.md');
    fixture.componentRef.setInput('state', 'modified');
    fixture.componentRef.setInput('waiting', true);
    await settle(fixture);

    expect(diff).not.toHaveBeenCalled();
    expect(host().querySelector('ui-spinner')).not.toBeNull();

    fixture.componentRef.setInput('waiting', false);
    await settle(fixture);

    expect(diff).toHaveBeenCalledTimes(1);
    expect(rows()).toHaveLength(3);
  });

  // Thousands of rows are slow to render without a browser, above all with other projects' tests running.
  describe('a long diff', { timeout: 30_000 }, () => {
    const added = (count: number): DiffLine[] =>
      Array.from({ length: count }, (_, index) => ({
        type: 'added' as const,
        oldLine: null,
        newLine: index + 1,
        text: `line ${index + 1}`
      }));

    it('renders the first rows, and more on request', async () => {
      diff.mockReturnValue(of(textDiff(added(4500))));
      await render('README.md', 'added', {
        [`${KEY}.rowsShown`]: '{{ shown }} of {{ total }}',
        [`${KEY}.showNextRows`]: 'Show {{ count }} more rows'
      });

      expect(rows()).toHaveLength(2000);
      expect(text()).toContain('2000 of 4500');

      button('Show 2000 more rows')?.click();
      await settle(fixture);
      expect(rows()).toHaveLength(4000);

      button('Show 500 more rows')?.click();
      await settle(fixture);
      expect(rows()).toHaveLength(4500);
      expect(host().querySelector('.more')).toBeNull();
    });

    it('keeps the focus in the diff when the last rows are shown', async () => {
      diff.mockReturnValue(of(textDiff(added(2500))));
      await render('README.md', 'added');
      document.body.append(host());

      button(`${KEY}.showNextRows`)?.click();
      await settle(fixture);

      expect(document.activeElement).toBe(host().querySelector('.scroller'));
      host().remove();
    });

    it('offers nothing more for a diff that fits', async () => {
      diff.mockReturnValue(of(textDiff(added(2000))));
      await render('README.md', 'added');

      expect(rows()).toHaveLength(2000);
      expect(host().querySelector('.more')).toBeNull();
    });

    it('starts again from the first rows for another file, and keeps its rows on a new read', async () => {
      diff.mockReturnValue(of(textDiff(added(4500))));
      await render('a.md', 'added');
      button(`${KEY}.showNextRows`)?.click();
      await settle(fixture);
      expect(rows()).toHaveLength(4000);

      status.set({ ...STATUS });
      await settle(fixture);
      expect(rows()).toHaveLength(4000);

      fixture.componentRef.setInput('path', 'b.md');
      await settle(fixture);
      expect(rows()).toHaveLength(2000);
    });
  });

  describe('opened folds and new reads', () => {
    /** A change on line 1, and unchanged lines to line 50; `extra` more changed lines move the fold's start. */
    function changedAtTop(extra: number): GitDiff {
      const changed = Array.from({ length: 1 + extra }, (_, index): DiffLine[] => [
        { type: 'removed', oldLine: index + 1, newLine: null, text: 'old' },
        { type: 'added', oldLine: null, newLine: index + 1, text: 'new' }
      ]).flat();
      return textDiff([ ...changed, ...context(49 - extra, 2 + extra) ]);
    }

    const showMore = () => button(`${KEY}.showMore`);

    it('keeps a fold open when changes above it move its start', async () => {
      diff.mockReturnValue(of(changedAtTop(0)));
      await render();
      showMore()?.click();
      await settle(fixture);
      expect(showMore()).toBeUndefined();

      diff.mockReturnValue(of(changedAtTop(2)));
      status.set({ ...STATUS });
      await settle(fixture);

      expect(showMore()).toBeUndefined();
    });

    it('leaves closed a fold that shares no lines with an opened one', async () => {
      const twoFolds = (changeAt: number): GitDiff =>
        textDiff([
          ...context(changeAt - 1),
          { type: 'removed', oldLine: changeAt, newLine: null, text: 'old' },
          { type: 'added', oldLine: null, newLine: changeAt, text: 'new' },
          ...context(60 - changeAt, changeAt + 1)
        ]);
      diff.mockReturnValue(of(twoFolds(30)));
      await render();
      // The first of the two folds, lines 4 to 26.
      showMore()?.click();
      await settle(fixture);
      expect(host().querySelectorAll('.open-fold')).toHaveLength(1);

      diff.mockReturnValue(of(twoFolds(31)));
      status.set({ ...STATUS });
      await settle(fixture);

      expect(host().querySelectorAll('.open-fold')).toHaveLength(1);
      expect(rows().some(row => row.querySelector('.old')?.textContent === '10')).toBe(true);
      expect(rows().some(row => row.querySelector('.old')?.textContent === '45')).toBe(false);
    });

    it('forgets an opened fold that a new read no longer has', async () => {
      diff.mockReturnValue(of(changedAtTop(0)));
      await render();
      showMore()?.click();
      await settle(fixture);

      diff.mockReturnValue(of(textDiff(CHANGED)));
      status.set({ ...STATUS });
      await settle(fixture);
      diff.mockReturnValue(of(changedAtTop(0)));
      status.set({ ...STATUS });
      await settle(fixture);

      expect(showMore()).toBeDefined();
    });
  });

  it('offers Try again when loading fails', async () => {
    diff.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
    await render();

    expect(text()).toContain(`${KEY}.failed`);
    expect(host().querySelector('ui-spinner')).toBeNull();

    diff.mockReturnValue(of(textDiff(CHANGED)));
    button(`${KEY}.retry`)?.click();
    await settle(fixture);

    expect(text()).not.toContain(`${KEY}.failed`);
    expect(rows()).toHaveLength(3);
  });
});
