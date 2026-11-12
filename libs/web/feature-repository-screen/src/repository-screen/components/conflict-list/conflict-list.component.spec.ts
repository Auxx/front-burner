import { type ComponentFixture, TestBed } from '@angular/core/testing';
import type { GitConflictFile, GitConflictKind, GitMergeState } from '@front-burner/shared-contracts';

import { translocoTesting } from '../../../testing/transloco-testing';
import { ConflictListComponent, OTHER_FILES_SHOWN } from './conflict-list.component';

const KEY = 'web-feature-repository-screen.ConflictListComponent';

function conflict(path: string, kind: GitConflictKind = 'both-changed', resolved = false): GitConflictFile {
  return { path, kind, resolved, editable: true, edited: false, oursSize: 1, theirsSize: 1 };
}

function merge(files: GitConflictFile[], otherFiles: string[] = []): GitMergeState {
  return { into: 'main', from: 'origin/main', files, otherFiles, message: 'Merge' };
}

describe('ConflictListComponent', () => {
  let fixture: ComponentFixture<ConflictListComponent>;

  const host = () => fixture.nativeElement as HTMLElement;
  const entries = () => [ ...host().querySelectorAll<HTMLButtonElement>('.entry') ];
  const toggle = () => host().querySelector<HTMLButtonElement>('.toggle');
  const texts = (selector: string) => [ ...host().querySelectorAll(selector) ].map(item => item.textContent?.trim());

  async function show(state: GitMergeState, selected: string | null = null): Promise<void> {
    fixture.componentRef.setInput('state', state);
    fixture.componentRef.setInput('selected', selected);
    await fixture.whenStable();
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [
        ConflictListComponent,
        translocoTesting({
          // The test module has no ICU transpiler; en.json's plurals are checked by the web application.
          [`${KEY}.otherFiles`]: '{{ count }} other files merged without conflicts',
          [`${KEY}.more`]: 'and {{ count }} more'
        })
      ]
    });
    fixture = TestBed.createComponent(ConflictListComponent);
  });

  it('lists the files sorted, with their kinds and states in words', async () => {
    await show(merge([
      conflict('docs/a.md', 'both-changed'),
      conflict('docs/b.md', 'both-added', true),
      conflict('c.md', 'deleted-by-us'),
      conflict('d.png', 'deleted-by-them', true)
    ]));

    // In the API's order, which is sorted by path.
    expect(texts('.name')).toEqual([ 'a.md', 'b.md', 'c.md', 'd.png' ]);
    expect(texts('.folder')).toEqual([ 'docs', 'docs' ]);
    expect(texts('.kind')).toEqual([
      `${KEY}.both-changed`,
      `${KEY}.both-added`,
      `${KEY}.deleted-by-us`,
      `${KEY}.deleted-by-them`
    ]);
    expect(texts('.state')).toEqual([
      `${KEY}.unresolved`,
      `${KEY}.resolved`,
      `${KEY}.unresolved`,
      `${KEY}.resolved`
    ]);
    // The icon repeats the word (NF-13.7).
    expect(host().querySelectorAll('.state ui-icon')).toHaveLength(4);
    expect(host().querySelectorAll('.state.resolved')).toHaveLength(2);
    expect(host().querySelector('ul')?.getAttribute('aria-label')).toBe(`${KEY}.label`);
  });

  it('marks the selected file and asks for the one selected', async () => {
    await show(merge([ conflict('a.md'), conflict('b.md') ]), 'b.md');
    const selected: string[] = [];
    fixture.componentInstance.selectPath.subscribe(path => selected.push(path));

    expect(entries().map(entry => entry.getAttribute('aria-current'))).toEqual([ null, 'true' ]);
    entries()[0].click();

    expect(selected).toEqual([ 'a.md' ]);
  });

  it('does not show the line without other files', async () => {
    await show(merge([ conflict('a.md') ]));

    expect(toggle()).toBeNull();
  });

  it('expands the files merged without conflicts', async () => {
    await show(merge([ conflict('a.md') ], [ 'b.md', 'docs/c.md', 'e.md' ]));

    expect(toggle()?.textContent?.trim()).toBe('3 other files merged without conflicts');
    expect(toggle()?.getAttribute('aria-expanded')).toBe('false');
    expect(host().querySelector('.other-files')).toBeNull();

    toggle()?.click();
    await fixture.whenStable();

    expect(toggle()?.getAttribute('aria-expanded')).toBe('true');
    expect(texts('.other-files li')).toEqual([ 'b.md', 'docs/c.md', 'e.md' ]);
    expect(host().querySelector('.more')).toBeNull();

    toggle()?.click();
    await fixture.whenStable();
    expect(host().querySelector('.other-files')).toBeNull();
  });

  it('shows the first 200 of 5,000 other files', async () => {
    const others = Array.from({ length: 5000 }, (_, index) => `f${String(index).padStart(4, '0')}.md`);
    await show(merge([ conflict('a.md') ], others));

    expect(toggle()?.textContent?.trim()).toBe('5000 other files merged without conflicts');
    toggle()?.click();
    await fixture.whenStable();

    expect(host().querySelectorAll('.other-files li')).toHaveLength(OTHER_FILES_SHOWN);
    expect(OTHER_FILES_SHOWN).toBe(200);
    expect(texts('.other-files li')[0]).toBe('f0000.md');
    expect(host().querySelector('.more')?.textContent?.trim()).toBe('and 4800 more');
  });

  it('takes the focus on the selected file, or the first one', async () => {
    await show(merge([ conflict('a.md'), conflict('b.md') ]), 'b.md');
    document.body.append(host());

    fixture.componentInstance.focus();
    expect(document.activeElement).toBe(entries()[1]);

    fixture.componentRef.setInput('selected', null);
    await fixture.whenStable();
    fixture.componentInstance.focus();
    expect(document.activeElement).toBe(entries()[0]);
    host().remove();
  });
});
