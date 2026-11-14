import { type ComponentFixture, TestBed } from '@angular/core/testing';
import type { GitConflictFile, GitResolution } from '@front-burner/shared-contracts';
import { GitApi } from '@front-burner/web-api-client';
import { of } from 'rxjs';

import { settle } from '../../../testing/settle';
import { translocoTesting } from '../../../testing/transloco-testing';
import { ConflictFileComponent } from './conflict-file.component';

const KEY = 'web-feature-repository-screen.ConflictFileComponent';

describe('ConflictFileComponent', () => {
  let fixture: ComponentFixture<ConflictFileComponent>;
  let gitMergeVersion: ReturnType<typeof vi.fn>;

  const host = () => fixture.nativeElement as HTMLElement;
  const text = (selector: string) => host().querySelector(selector)?.textContent?.trim();
  const buttons = () => [ ...host().querySelectorAll<HTMLButtonElement>('.offers button') ];
  const labels = () => buttons().map(button => button.textContent?.trim());

  async function show(file: Partial<GitConflictFile>, resolving: GitResolution | null = null): Promise<void> {
    fixture.componentRef.setInput('repositoryId', 12);
    fixture.componentRef.setInput('file', {
      path: 'docs/guide.md',
      kind: 'both-changed',
      resolved: false,
      editable: true,
      edited: false,
      oursSize: 1,
      theirsSize: 1,
      oursShowable: true,
      theirsShowable: true,
      ...file
    });
    fixture.componentRef.setInput('into', 'main');
    fixture.componentRef.setInput('from', 'origin/main');
    fixture.componentRef.setInput('resolving', resolving);
    await fixture.whenStable();
  }

  beforeEach(() => {
    gitMergeVersion = vi.fn((_id: number, query: { path: string; side: string; }) =>
      of({ content: `${query.side} of ${query.path}` })
    );
    TestBed.configureTestingModule({
      imports: [
        ConflictFileComponent,
        translocoTesting({
          [`${KEY}.deletedByUsNote`]: 'You deleted this file; {{ from }} changed it.',
          [`${KEY}.deletedByThemNote`]: '{{ from }} deleted this file; you changed it.',
          [`${KEY}.mine`]: 'Mine ({{ into }})',
          [`${KEY}.theirs`]: 'Theirs ({{ from }})'
        })
      ],
      providers: [ { provide: GitApi, useValue: { gitMergeVersion } } ]
    });
    fixture = TestBed.createComponent(ConflictFileComponent);
  });

  it('shows the file\'s name, folder, kind and state', async () => {
    await show({});

    expect(text('h2')).toBe('guide.md');
    expect(text('.folder')).toBe('docs');
    expect(text('.kind')).toBe(`${KEY}.both-changed`);
    expect(text('.state')).toBe(`${KEY}.unresolved`);
  });

  it('shows no folder for a file in the root folder, and a resolved file as such', async () => {
    await show({ path: 'a.md', kind: 'deleted-by-them', resolved: true });

    expect(host().querySelector('.folder')).toBeNull();
    expect(text('.kind')).toBe(`${KEY}.deleted-by-them`);
    expect(text('.state')).toBe(`${KEY}.resolved`);
  });

  it('offers what each kind allows', async () => {
    await show({ path: 'logo.png', editable: false });
    expect(labels()).toEqual([ `${KEY}.offer.ours`, `${KEY}.offer.theirs` ]);

    await show({ kind: 'both-added' });
    expect(labels()).toEqual([ `${KEY}.offer.ours`, `${KEY}.offer.theirs` ]);

    await show({ kind: 'deleted-by-them', theirsSize: null });
    expect(labels()).toEqual([ `${KEY}.offer.keep`, `${KEY}.offer.delete` ]);

    await show({ kind: 'deleted-by-us', oursSize: null });
    expect(labels()).toEqual([ `${KEY}.offer.keep`, `${KEY}.offer.delete` ]);
  });

  it('offers nothing for a resolved file', async () => {
    await show({ resolved: true });

    expect(buttons()).toEqual([]);
  });

  it('says which side deleted the file', async () => {
    await show({ kind: 'deleted-by-us', oursSize: null });
    expect(text('.deleted-by')).toBe('You deleted this file; origin/main changed it.');

    await show({ kind: 'deleted-by-them', theirsSize: null });
    expect(text('.deleted-by')).toBe('origin/main deleted this file; you changed it.');

    await show({ kind: 'both-changed' });
    expect(host().querySelector('.deleted-by')).toBeNull();
  });

  it('shows the size of each version', async () => {
    await show({ oursSize: 1536, theirsSize: 20 });

    expect(text('.versions')).toMatch(/Mine \(main\)\s*1\.5 KB\s*Theirs \(origin\/main\)\s*20 B/);

    await show({ kind: 'deleted-by-them', oursSize: 3 * 1024 * 1024, theirsSize: null });

    expect(text('.versions')).toMatch(/Mine \(main\)\s*3 MB\s*Theirs \(origin\/main\)\s*.*\.deleted/);
  });

  it('shows a version without a size, such as a submodule, as such', async () => {
    await show({ oursSize: null, theirsSize: 4 });

    expect(text('.versions')).toMatch(/Mine \(main\)\s*.*\.noSize/);
  });

  it('emits the chosen resolution', async () => {
    await show({ kind: 'deleted-by-them', theirsSize: null });
    const chosen: GitResolution[] = [];
    fixture.componentInstance.resolve.subscribe(resolution => chosen.push(resolution));

    buttons()[1].click();

    expect(chosen).toEqual([ 'delete' ]);
  });

  it('shows the choice running as busy, and every choice as unavailable while locked, without emitting', async () => {
    fixture.componentRef.setInput('locked', true);
    await show({}, 'theirs');
    const chosen: GitResolution[] = [];
    fixture.componentInstance.resolve.subscribe(resolution => chosen.push(resolution));

    const [ ours, theirs ] = buttons();
    expect(theirs.getAttribute('aria-disabled')).toBe('true');
    expect(ours.getAttribute('aria-disabled')).toBe('true');
    expect(theirs.querySelector('ui-spinner')).not.toBeNull();

    ours.click();
    expect(chosen).toEqual([]);
  });

  describe('Show mine and Show theirs', () => {
    const showButtons = () => [ ...host().querySelectorAll<HTMLButtonElement>('.shows button') ];
    const version = () => host().querySelector('rs-conflict-version');

    it('offers both for a Markdown file, resolved or not', async () => {
      await show({});
      expect(showButtons().map(button => button.textContent?.trim())).toEqual([
        `${KEY}.show.ours`,
        `${KEY}.show.theirs`
      ]);

      await show({ resolved: true });
      expect(showButtons()).toHaveLength(2);
    });

    it('offers no button for a large file or a PNG', async () => {
      await show({
        oursSize: 2 * 1024 * 1024,
        theirsSize: 2 * 1024 * 1024,
        oursShowable: false,
        theirsShowable: false
      });
      expect(showButtons()).toEqual([]);
      expect(text('.versions')).toMatch(/2 MB/);

      await show({ path: 'logo.png', editable: false, oursShowable: false, theirsShowable: false });
      expect(showButtons()).toEqual([]);

      await show({ kind: 'deleted-by-them', theirsSize: null, theirsShowable: false });
      expect(showButtons().map(button => button.textContent?.trim())).toEqual([ `${KEY}.show.ours` ]);
    });

    /** Clicks a show button, and waits for the deferred version to load and answer. */
    async function open(index: number): Promise<void> {
      showButtons()[index].click();
      await settle(fixture);
      await settle(fixture);
    }

    it('opens the version read-only in place of the file\'s choices', async () => {
      await show({});

      await open(1);

      expect(gitMergeVersion).toHaveBeenCalledExactlyOnceWith(12, { path: 'docs/guide.md', side: 'theirs' });
      expect(version()?.querySelector('.cm-content')?.textContent).toBe('theirs of docs/guide.md');
      expect(host().querySelector('.offers')).toBeNull();
      expect(host().classList).toContain('showing');
    });

    it('Back returns focus to its button', async () => {
      await show({});
      await open(1);

      (version()?.querySelector('ui-inline-banner button') as HTMLButtonElement).click();
      await settle(fixture);

      expect(version()).toBeNull();
      expect(host().classList).not.toContain('showing');
      expect(document.activeElement).toBe(showButtons()[1]);
    });

    it('gives the focus to Back when a version opens, as its button is gone', async () => {
      await show({});
      showButtons()[0].focus();

      await open(0);

      expect(document.activeElement?.textContent?.trim()).toBe(
        'web-feature-repository-screen.ConflictVersionComponent.back'
      );
    });

    it('gives the focus to the file\'s name after Back when the version\'s button has gone meanwhile', async () => {
      await show({});
      await open(1);

      await show({ theirsShowable: false });
      (version()?.querySelector('ui-inline-banner button') as HTMLButtonElement).click();
      await settle(fixture);

      expect(document.activeElement).toBe(host().querySelector('h2'));
    });

    it('goes when another file is selected, and stays when the same file is read again', async () => {
      await show({});
      await open(0);
      expect(version()).not.toBeNull();

      await show({ resolved: true });
      expect(version()).not.toBeNull();
      expect(gitMergeVersion).toHaveBeenCalledOnce();

      await show({ path: 'notes.md' });
      expect(version()).toBeNull();
      expect(text('h2')).toBe('notes.md');
    });
  });
});
