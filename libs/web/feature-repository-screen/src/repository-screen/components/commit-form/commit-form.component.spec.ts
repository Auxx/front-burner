import { signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { TooltipDirective } from '@front-burner/ui';

import { settle } from '../../../testing/settle';
import { translocoTesting } from '../../../testing/transloco-testing';
import { CommitTicksService } from '../../services/commit-ticks/commit-ticks.service';
import { type CommitFailure, CommitService } from '../../services/commit/commit.service';
import { CommitFormComponent } from './commit-form.component';

const KEY = 'web-feature-repository-screen.CommitFormComponent';

describe('CommitFormComponent', () => {
  let fixture: ComponentFixture<CommitFormComponent>;
  let ticked: ReturnType<typeof signal<string[]>>;
  let message: ReturnType<typeof signal<string>>;
  let busy: ReturnType<typeof signal<boolean>>;
  let error: ReturnType<typeof signal<CommitFailure | null>>;
  let commit: ReturnType<typeof vi.fn>;

  const host = () => fixture.nativeElement as HTMLElement;
  const field = () => host().querySelector('textarea') as HTMLTextAreaElement;
  const button = () => host().querySelector('.commit') as HTMLButtonElement;
  const reason = () => fixture.debugElement.query(By.css('.commit')).injector.get(TooltipDirective).text();

  async function render(): Promise<void> {
    fixture = TestBed.createComponent(CommitFormComponent);
    await settle(fixture);
  }

  async function type(text: string): Promise<void> {
    field().value = text;
    field().dispatchEvent(new Event('input'));
    await settle(fixture);
  }

  beforeEach(() => {
    ticked = signal([ 'a.md', 'b.md' ]);
    message = signal('');
    busy = signal(false);
    error = signal<CommitFailure | null>(null);
    commit = vi.fn(() => Promise.resolve(true));
    TestBed.configureTestingModule({
      imports: [
        CommitFormComponent,
        translocoTesting({
          [`${KEY}.commitOne`]: 'Commit 1 file',
          [`${KEY}.commitMany`]: 'Commit {{ count }} files'
        })
      ],
      providers: [
        { provide: CommitTicksService, useValue: { ticked } },
        { provide: CommitService, useValue: { message, busy, error, commit } }
      ]
    });
  });

  it('says how many files it commits', async () => {
    await render();
    expect(button().textContent?.trim()).toBe('Commit 2 files');

    ticked.set([ 'a.md' ]);
    await settle(fixture);
    expect(button().textContent?.trim()).toBe('Commit 1 file');
  });

  it('needs a message and a ticked file', async () => {
    await render();
    await type('  \n ');
    expect(button().getAttribute('aria-disabled')).toBe('true');
    expect(reason()).toBe(`${KEY}.needsMessage`);
    button().click();
    expect(commit).not.toHaveBeenCalled();

    await type('Subject');
    expect(button().getAttribute('aria-disabled')).toBeNull();
    expect(reason()).toBe('');

    ticked.set([]);
    await settle(fixture);
    expect(button().getAttribute('aria-disabled')).toBe('true');
    expect(reason()).toBe(`${KEY}.needsFile`);
    button().click();
    expect(commit).not.toHaveBeenCalled();
  });

  it('says so when more files are ticked than one commit takes', async () => {
    ticked.set(Array.from({ length: 10_001 }, (_, index) => `${index}.md`));
    await render();
    await type('Subject');

    expect(button().getAttribute('aria-disabled')).toBe('true');
    expect(reason()).toBe(`${KEY}.tooManyFiles`);
  });

  it('sends the message as written', async () => {
    await render();
    await type('Subject\n\n# kept\n');

    button().click();

    expect(commit).toHaveBeenCalledExactlyOnceWith('Subject\n\n# kept\n');
  });

  it('shows the message it keeps, as after moving between Files and Changes', async () => {
    message.set('Kept');
    await render();

    expect(field().value).toBe('Kept');
  });

  it('shows a hint only when the first line is longer than 72 characters, and refuses nothing', async () => {
    await render();
    await type(`${'x'.repeat(72)}\n${'y'.repeat(100)}`);
    expect(host().textContent).not.toContain(`${KEY}.longSubject`);

    await type('x'.repeat(73));
    expect(host().textContent).toContain(`${KEY}.longSubject`);
    expect(button().getAttribute('aria-disabled')).toBeNull();
  });

  it('shows progress and keeps the text while committing', async () => {
    message.set('Subject');
    busy.set(true);
    await render();

    expect(button().getAttribute('aria-disabled')).toBe('true');
    expect(field().readOnly).toBe(true);
  });

  it('shows a failure with its reference, and Try again only when it can help', async () => {
    message.set('Subject');
    error.set({ text: 'Confirm first', reference: 'abcdefgh', retry: false });
    await render();
    expect(host().querySelector('ui-inline-banner')?.textContent).toContain('Confirm first');
    expect(host().querySelector('ui-inline-banner code')?.textContent).toBe('abcdefgh');
    expect(host().querySelector('.retry')).toBeNull();

    error.set({ text: 'No network', reference: null, retry: true });
    await settle(fixture);
    (host().querySelector('.retry') as HTMLButtonElement).click();

    expect(commit).toHaveBeenCalledExactlyOnceWith('Subject');
  });
});
