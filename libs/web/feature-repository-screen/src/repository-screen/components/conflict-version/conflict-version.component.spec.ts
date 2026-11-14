import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import type { GitMergeVersion } from '@front-burner/shared-contracts';
import { GitApi } from '@front-burner/web-api-client';
import type { EditorStateChange } from '@front-burner/web-code-editor';
import { type Observable, of, Subject, throwError } from 'rxjs';

import { settle } from '../../../testing/settle';
import { translocoTesting } from '../../../testing/transloco-testing';
import { ConflictVersionComponent } from './conflict-version.component';

const KEY = 'web-feature-repository-screen.ConflictVersionComponent';

describe('ConflictVersionComponent', () => {
  let gitMergeVersion: ReturnType<
    typeof vi.fn<(id: number, query: { path: string; side: 'ours' | 'theirs'; }) => Observable<GitMergeVersion>>
  >;
  let fixture: ComponentFixture<ConflictVersionComponent>;

  const host = () => fixture.nativeElement as HTMLElement;
  const banner = () => host().querySelector('.banner')?.textContent?.trim() ?? '';
  const content = () => host().querySelector<HTMLElement>('.cm-content');
  const backButton = () => host().querySelector('.banner button') as HTMLButtonElement;

  async function render(side: 'ours' | 'theirs' = 'ours'): Promise<void> {
    fixture = TestBed.createComponent(ConflictVersionComponent);
    fixture.componentRef.setInput('repositoryId', 12);
    fixture.componentRef.setInput('path', 'docs/guide.md');
    fixture.componentRef.setInput('side', side);
    fixture.componentRef.setInput('from', 'origin/main');
    await settle(fixture);
  }

  beforeEach(() => {
    gitMergeVersion = vi.fn(() => of({ content: '# Guide\n\nMy text.\n' }));
    TestBed.configureTestingModule({
      imports: [
        ConflictVersionComponent,
        translocoTesting({
          [`${KEY}.mine`]: 'This is your version, read-only.',
          [`${KEY}.theirs`]: 'This is their version ({{ from }}), read-only.',
          [`${KEY}.label.ours`]: '{{ name }}, my version',
          'errors.version-not-readable': 'This version of the file cannot be read.'
        })
      ],
      providers: [ { provide: GitApi, useValue: { gitMergeVersion } } ]
    });
  });

  it('shows my version with its banner', async () => {
    await render('ours');

    expect(gitMergeVersion).toHaveBeenCalledExactlyOnceWith(12, { path: 'docs/guide.md', side: 'ours' });
    expect(banner()).toContain('This is your version, read-only.');
    expect(content()?.textContent).toBe('# GuideMy text.');
    expect(content()?.getAttribute('aria-label')).toBe('guide.md, my version');
  });

  it('names the branch their version comes from', async () => {
    await render('theirs');

    expect(gitMergeVersion).toHaveBeenCalledExactlyOnceWith(12, { path: 'docs/guide.md', side: 'theirs' });
    expect(banner()).toContain('This is their version (origin/main), read-only.');
  });

  it('cannot be edited, with no keyboard on a phone', async () => {
    await render();
    const editor = fixture.debugElement.query(element => element.name === 'ce-code-editor');
    const state = (editor.componentInstance as { state(): EditorStateChange['state']; }).state();

    // Not content-editable: a phone opens no on-screen keyboard for it.
    expect(content()?.getAttribute('contenteditable')).toBe('false');
    expect(state.readOnly).toBe(true);
  });

  it('shows a spinner until the version answers', async () => {
    const answer = new Subject<GitMergeVersion>();
    gitMergeVersion.mockReturnValue(answer);
    await render();

    expect(host().querySelector('ui-spinner')).not.toBeNull();
    expect(content()).toBeNull();

    answer.next({ content: 'Text' });
    await settle(fixture);

    expect(host().querySelector('ui-spinner')).toBeNull();
    expect(content()?.textContent).toBe('Text');
  });

  it('says why a version cannot be shown', async () => {
    gitMergeVersion.mockReturnValue(throwError(() =>
      new HttpErrorResponse({
        status: 409,
        headers: new HttpHeaders({ 'X-Request-Id': 'abcdef1234567890' }),
        error: {
          code: 'version-not-readable',
          params: {},
          requestId: 'abcdef1234567890',
          message: 'Version not readable'
        }
      })
    ));
    await render();

    const failure = host().querySelector('.failure');
    expect(failure?.textContent).toContain('This version of the file cannot be read.');
    expect(failure?.textContent).toContain('abcdef12');
    expect(content()).toBeNull();
    expect(backButton()).not.toBeNull();
  });

  it('emits Back', async () => {
    await render();
    let backs = 0;
    fixture.componentInstance.back.subscribe(() => backs++);

    backButton().click();

    expect(backs).toBe(1);
  });

  it('reads the other version when the side changes', async () => {
    await render('ours');
    gitMergeVersion.mockReturnValue(of({ content: 'Theirs' }));

    fixture.componentRef.setInput('side', 'theirs');
    await settle(fixture);

    expect(gitMergeVersion).toHaveBeenLastCalledWith(12, { path: 'docs/guide.md', side: 'theirs' });
    expect(content()?.textContent).toBe('Theirs');
  });
});
