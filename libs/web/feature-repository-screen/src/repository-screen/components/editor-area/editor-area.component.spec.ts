import { signal } from '@angular/core';
import { ComponentFixture, DeferBlockBehavior, DeferBlockState, TestBed } from '@angular/core/testing';
import type { ApiError, CurrentUser, Entry } from '@front-burner/shared-contracts';
import { ChunkPreloaderService, CurrentUserService } from '@front-burner/web-core';
import type { Mock } from 'vitest';

import { entry } from '../../../testing/listings';
import { openFile } from '../../../testing/open-files';
import { settle } from '../../../testing/settle';
import { translocoTesting } from '../../../testing/transloco-testing';
import { DiskChangesService } from '../../services/disk-changes/disk-changes.service';
import { OpenFilesService } from '../../services/open-files/open-files.service';
import { RepositorySessionService } from '../../services/repository-session/repository-session.service';
import { ViewModeService } from '../../services/view-mode/view-mode.service';
import { EditorAreaComponent } from './editor-area.component';

const K = 'web-feature-repository-screen.EditorAreaComponent';

function failure(code: string): ApiError {
  return { code, params: {}, requestId: 'abcdef0123456789', message: code };
}

/** The providers of the editor area and its editor pane, with the chunk preloader's `preload` as given. */
function providers(preload: (group: string) => void) {
  return [
    { provide: OpenFilesService, useValue: {} },
    { provide: DiskChangesService, useValue: {} },
    { provide: RepositorySessionService, useValue: { repository: signal({ id: 12 }) } },
    ViewModeService,
    { provide: CurrentUserService, useValue: { user: signal<CurrentUser | undefined>(undefined) } },
    { provide: ChunkPreloaderService, useValue: { preload } }
  ];
}

describe('EditorAreaComponent', () => {
  let fixture: ComponentFixture<EditorAreaComponent>;
  let preload: Mock<(group: string) => void>;

  const area = () => fixture.nativeElement as HTMLElement;

  async function show(path: string | null, shown?: Entry | null): Promise<void> {
    fixture.componentRef.setInput('path', path);
    fixture.componentRef.setInput('entry', shown);
    await settle(fixture);
  }

  beforeEach(async () => {
    preload = vi.fn();
    TestBed.configureTestingModule({
      imports: [ EditorAreaComponent, translocoTesting() ],
      providers: providers(preload)
    });
    fixture = TestBed.createComponent(EditorAreaComponent);
    await settle(fixture);
  });

  it('NF-2.2: asks for the editor\'s chunks when a Markdown file is chosen, before the file has arrived', async () => {
    expect(preload).not.toHaveBeenCalled();

    await show('docs/guide.md', entry('guide.md'));

    expect(preload).toHaveBeenCalledWith('editor');
    expect(area().querySelector('rs-editor-pane')).toBeNull();
  });

  it('does not ask for the editor\'s chunks for a file that is not Markdown', async () => {
    await show('logo.png', entry('logo.png'));
    await show('docs', entry('docs', { kind: 'folder' }));

    expect(preload).not.toHaveBeenCalled();
  });

  it('shows the empty state', () => {
    expect(area().querySelector('ui-empty-state .message')?.textContent?.trim()).toBe(`${K}.empty`);
  });

  it('offers New file in the empty state', () => {
    const emitted: unknown[] = [];
    fixture.componentInstance.newFile.subscribe(() => emitted.push(true));

    (area().querySelector('[uiEmptyStateActions] button') as HTMLButtonElement).click();

    expect(area().querySelector('[uiEmptyStateActions] button')?.textContent?.trim()).toBe(`${K}.newFile`);
    expect(emitted).toEqual([ true ]);
  });

  it('shows nothing while the entry is being found', async () => {
    await show('docs/guide.md', undefined);

    expect(area().textContent?.trim()).toBe('');
  });

  it('ED-5: shows a loading state while a Markdown file opens', async () => {
    await show('docs/guide.md', entry('guide.md'));

    expect(area().querySelector('ui-spinner')?.getAttribute('aria-label')).toBe(`${K}.opening`);
    expect(area().querySelector('rs-editor-pane')).toBeNull();
  });

  it('shows the open file in the editor', async () => {
    fixture.componentRef.setInput('file', openFile('docs/guide.md'));
    await show('docs/guide.md', entry('guide.md'));
    await settle(fixture);

    expect(area().querySelector('rs-editor-pane .cm-content')?.textContent).toContain('# docs/guide.md');
    expect(area().querySelector('ui-spinner')).toBeNull();
  });

  it('AC-FILE-001.10: shows why a Markdown file could not be opened in the message panel', async () => {
    fixture.componentRef.setInput('openError', failure('file-too-large'));
    await show('docs/big.md', entry('big.md'));

    expect(area().querySelector('rs-entry-message')?.textContent).toContain(
      'web-feature-repository-screen.EntryMessageComponent.tooLarge'
    );
    expect(area().querySelector('rs-editor-pane')).toBeNull();
  });

  it('says opening failed otherwise, with Try again', async () => {
    const retried: unknown[] = [];
    fixture.componentInstance.retryOpen.subscribe(() => retried.push(true));
    fixture.componentRef.setInput('openError', failure('internal'));
    await show('docs/guide.md', entry('guide.md'));

    expect(area().textContent).toContain(`${K}.openFailed`);
    (area().querySelector('[uiEmptyStateActions] button') as HTMLButtonElement).click();

    expect(retried).toEqual([ true ]);
  });

  it('says why another entry cannot be opened', async () => {
    await show('logo.png', entry('logo.png'));

    expect(area().querySelector('rs-entry-message')).not.toBeNull();
  });

  it('says the open file was deleted or renamed elsewhere', async () => {
    fixture.componentRef.setInput('goneElsewhere', true);
    await show('docs/guide.md', entry('guide.md'));

    expect(area().querySelector('ui-empty-state h2')?.textContent?.trim()).toBe('guide.md');
    expect(area().textContent).toContain(`${K}.goneElsewhere`);
  });

  it('passes on the actions of the entry message', async () => {
    const emitted: unknown[] = [];
    fixture.componentInstance.action.subscribe(action => emitted.push(action));

    await show('docs/logo.png', entry('logo.png'));
    (area().querySelector('rs-entry-message button') as HTMLButtonElement).click();

    expect(emitted).toEqual([ 'delete' ]);
  });
});

describe('EditorAreaComponent while the editor\'s chunk loads', () => {
  it('shows the file chosen last when the files change while the editor\'s chunk loads', async () => {
    TestBed.configureTestingModule({
      imports: [ EditorAreaComponent, translocoTesting() ],
      providers: providers(vi.fn()),
      deferBlockBehavior: DeferBlockBehavior.Manual
    });
    const fixture = TestBed.createComponent(EditorAreaComponent);
    const area = fixture.nativeElement as HTMLElement;
    fixture.componentRef.setInput('path', 'docs/a.md');
    fixture.componentRef.setInput('entry', entry('a.md'));
    await settle(fixture);
    expect(area.querySelector('ui-spinner')?.getAttribute('aria-label')).toBe(`${K}.opening`);

    const [ block ] = await fixture.getDeferBlocks();
    await block.render(DeferBlockState.Loading);
    fixture.componentRef.setInput('file', openFile('docs/a.md'));
    fixture.componentRef.setInput('path', 'docs/b.md');
    fixture.componentRef.setInput('entry', entry('b.md'));
    fixture.componentRef.setInput('file', openFile('docs/b.md'));
    await settle(fixture);
    expect(area.querySelector('rs-editor-pane')).toBeNull();

    const [ loaded ] = await fixture.getDeferBlocks();
    await loaded.render(DeferBlockState.Complete);
    await settle(fixture);

    expect(area.querySelector('rs-editor-pane .cm-content')?.textContent).toContain('# docs/b.md');
    expect(area.querySelector('rs-editor-pane .cm-content')?.textContent).not.toContain('# docs/a.md');
  });
});
