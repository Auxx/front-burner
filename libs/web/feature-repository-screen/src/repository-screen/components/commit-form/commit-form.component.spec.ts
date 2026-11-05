import { signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import type { RepositoryCommitAuthor } from '@front-burner/shared-contracts';
import { TooltipDirective } from '@front-burner/ui';

import { settle } from '../../../testing/settle';
import { translocoTesting } from '../../../testing/transloco-testing';
import { CommitAuthorGate } from '../../services/commit-author-gate/commit-author-gate.service';
import { type CommitFailure, CommitService } from '../../services/commit/commit.service';
import { CommitFormComponent } from './commit-form.component';

const KEY = 'web-feature-repository-screen.CommitFormComponent';

describe('CommitFormComponent', () => {
  let fixture: ComponentFixture<CommitFormComponent>;
  let paths: ReturnType<typeof signal<string[]>>;
  let message: ReturnType<typeof signal<string>>;
  let busy: ReturnType<typeof signal<boolean>>;
  let error: ReturnType<typeof signal<CommitFailure | null>>;
  let commit: ReturnType<typeof vi.fn>;
  let author: ReturnType<typeof signal<RepositoryCommitAuthor | null>>;
  let change: ReturnType<typeof vi.fn>;
  let readFailed: ReturnType<typeof signal<boolean>>;
  let refresh: ReturnType<typeof vi.fn>;

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
    paths = signal([ 'a.md', 'b.md' ]);
    message = signal('');
    busy = signal(false);
    error = signal<CommitFailure | null>(null);
    commit = vi.fn(() => Promise.resolve(true));
    author = signal<RepositoryCommitAuthor | null>({
      author: { name: 'Ada', email: 'ada@example.com' },
      source: 'default',
      confirmed: true
    });
    change = vi.fn(() => Promise.resolve());
    readFailed = signal(false);
    refresh = vi.fn();
    TestBed.configureTestingModule({
      imports: [
        CommitFormComponent,
        translocoTesting({
          [`${KEY}.commitOne`]: 'Commit 1 file',
          [`${KEY}.commitMany`]: 'Commit {{ count }} files',
          [`${KEY}.committingAs`]: 'Committing as {{ name }} <{{ email }}>'
        })
      ],
      providers: [
        { provide: CommitService, useValue: { paths, message, busy, error, commit } },
        { provide: CommitAuthorGate, useValue: { author, change, readFailed, refresh } }
      ]
    });
  });

  describe('the commit author', () => {
    const line = () => host().querySelector('.author-text')?.textContent?.trim();
    const changeButton = () => host().querySelector('.change') as HTMLButtonElement | null;

    it('shows Committing as, and Change opens the dialog', async () => {
      await render();

      expect(line()).toBe('Committing as Ada <ada@example.com>');
      changeButton()?.click();

      expect(change).toHaveBeenCalledTimes(1);
    });

    it('shows the author as text', async () => {
      author.set({ author: { name: 'O\'Brien & "Sons" <b>', email: 'a@b' }, source: 'override', confirmed: true });
      await render();

      expect(line()).toBe('Committing as O\'Brien & "Sons" <b> <a@b>');
      expect(host().querySelector('.author-text b')).toBeNull();
    });

    it('follows the author', async () => {
      await render();

      author.set({ author: { name: 'Ada L', email: 'a@work' }, source: 'override', confirmed: true });
      await settle(fixture);

      expect(line()).toBe('Committing as Ada L <a@work>');
    });

    it('warns, with Try again, instead of the line when the author can\'t be read', async () => {
      author.set(null);
      readFailed.set(true);
      await render();

      const warning = host().querySelector('.author-failed');
      expect(warning?.getAttribute('status')).toBe('warning');
      expect(warning?.textContent).toContain(`${KEY}.authorFailed`);
      expect(line()).toBeUndefined();
      expect(changeButton()).toBeNull();

      (host().querySelector('.author-retry') as HTMLButtonElement).click();

      expect(refresh).toHaveBeenCalledTimes(1);
    });

    it('still lets the user commit while warning', async () => {
      author.set(null);
      readFailed.set(true);
      message.set('Subject');
      await render();

      button().click();

      expect(commit).toHaveBeenCalledExactlyOnceWith('Subject');
    });

    it('shows nothing until the author is known', async () => {
      author.set(null);
      await render();

      expect(line()).toBeUndefined();
      expect(changeButton()).toBeNull();
    });

    it('can\'t change it while a commit runs', async () => {
      busy.set(true);
      await render();

      changeButton()?.click();

      expect(change).not.toHaveBeenCalled();
    });
  });

  it('says how many files it commits', async () => {
    await render();
    expect(button().textContent?.trim()).toBe('Commit 2 files');

    paths.set([ 'a.md' ]);
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

    paths.set([]);
    await settle(fixture);
    expect(button().getAttribute('aria-disabled')).toBe('true');
    expect(reason()).toBe(`${KEY}.needsFile`);
    button().click();
    expect(commit).not.toHaveBeenCalled();
  });

  it('says so when more files are ticked than one commit takes', async () => {
    paths.set(Array.from({ length: 10_001 }, (_, index) => `${index}.md`));
    await render();
    await type('Subject');

    expect(button().getAttribute('aria-disabled')).toBe('true');
    expect(reason()).toBe(`${KEY}.tooManyFiles`);
  });

  it('says so when the message is longer than a commit takes', async () => {
    await render();
    await type('x'.repeat(65_537));

    expect(button().getAttribute('aria-disabled')).toBe('true');
    expect(reason()).toBe(`${KEY}.messageTooLong`);

    await type('x'.repeat(65_536));
    expect(button().getAttribute('aria-disabled')).toBeNull();
  });

  it('keeps the focus in the form when Try again goes with its banner', async () => {
    message.set('Subject');
    error.set({ text: 'No network', reference: null, retry: true });
    await render();
    document.body.append(host());
    const retry = host().querySelector('.retry') as HTMLButtonElement;
    retry.focus();

    retry.click();
    error.set(null);
    await settle(fixture);

    expect(document.activeElement).toBe(button());
    host().remove();
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
