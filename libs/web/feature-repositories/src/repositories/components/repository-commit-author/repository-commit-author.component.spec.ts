import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { PushEvent, RepositoryCommitAuthor, RepositorySummary } from '@front-burner/shared-contracts';
import { DialogService } from '@front-burner/ui';
import { PreferencesApi } from '@front-burner/web-api-client';
import { PushChannelService } from '@front-burner/web-core';
import { ChangeCommitAuthorDialog } from '@front-burner/web-repository-dialogs';
import { type Observable, of, Subject, throwError } from 'rxjs';

import { apiFailure } from '../../../testing/api-failure';
import { repositoryDetails } from '../../../testing/repository-details';
import { settle } from '../../../testing/settle';
import { translocoTesting } from '../../../testing/transloco-testing';
import { RepositorySettingsStore } from '../../services/repository-settings-store/repository-settings-store.service';
import { RepositoryCommitAuthorComponent } from './repository-commit-author.component';

const KEY = 'web-feature-repositories.RepositoryCommitAuthorComponent';

const ada = { name: 'Ada', email: 'ada@example.com' };
const work = { name: 'Ada L', email: 'ada@work.example' };
const usingDefault: RepositoryCommitAuthor = { author: ada, source: 'default', confirmed: true };
const usingOverride: RepositoryCommitAuthor = { author: work, source: 'override', confirmed: true };

describe('RepositoryCommitAuthorComponent', () => {
  let fixture: ComponentFixture<RepositoryCommitAuthorComponent>;
  let answers: (() => Observable<RepositoryCommitAuthor>)[];
  let requested: number[];
  let api: {
    repositoryCommitAuthor: (id: number) => Observable<RepositoryCommitAuthor>;
    removeRepositoryCommitAuthor: ReturnType<typeof vi.fn>;
  };
  let open: ReturnType<typeof vi.fn>;
  let closed: Subject<RepositoryCommitAuthor | undefined>;
  let store: { reload: ReturnType<typeof vi.fn>; };
  let push: { events: Subject<PushEvent>; reconnected: Subject<void>; };

  const host = () => fixture.nativeElement as HTMLElement;
  const button = (name: string) => host().querySelector<HTMLButtonElement>(`button.${name}`);
  const author = () => host().querySelector('.author')?.textContent?.trim();
  const source = () => host().querySelector('.source')?.textContent?.trim();

  async function show(repository: RepositorySummary, ...replies: (() => Observable<RepositoryCommitAuthor>)[]) {
    answers = replies;
    requested = [];
    closed = new Subject();
    open = vi.fn(() => ({ closed }));
    store = { reload: vi.fn() };
    push = { events: new Subject(), reconnected: new Subject() };
    api = {
      repositoryCommitAuthor: (id: number) => {
        requested.push(id);
        return (answers.shift() ?? (() => of(usingDefault)))();
      },
      removeRepositoryCommitAuthor: vi.fn(() => of(usingDefault))
    };
    await TestBed.configureTestingModule({
      imports: [
        RepositoryCommitAuthorComponent,
        translocoTesting({
          [`${KEY}.commitsUse`]: 'Commits use {{ name }} <{{ email }}>',
          [`${KEY}.default`]: 'Your default commit author',
          [`${KEY}.override`]: 'Only for this repository'
        })
      ],
      providers: [
        { provide: PreferencesApi, useValue: api },
        { provide: DialogService, useValue: { open } },
        { provide: RepositorySettingsStore, useValue: store },
        { provide: PushChannelService, useValue: push }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(RepositoryCommitAuthorComponent);
    fixture.componentRef.setInput('repository', repository);
    await settle(fixture);
  }

  const ready = () => repositoryDetails().summary;

  it('is a section named by its heading', async () => {
    await show(ready());

    const heading = host().querySelector('h2');
    expect(heading?.textContent?.trim()).toBe(`${KEY}.heading`);
    expect(host().querySelector('section')?.getAttribute('aria-labelledby')).toBe(heading?.id);
    expect(requested).toEqual([ 7 ]);
  });

  it('shows the default', async () => {
    await show(ready(), () => of(usingDefault));

    expect(author()).toBe('Commits use Ada <ada@example.com>');
    expect(source()).toBe('Your default commit author');
    expect(button('change')?.textContent?.trim()).toBe(`${KEY}.change`);
    expect(button('use-default')).toBeNull();
  });

  it('shows an override', async () => {
    await show(ready(), () => of(usingOverride));

    expect(author()).toBe('Commits use Ada L <ada@work.example>');
    expect(source()).toBe('Only for this repository');
    expect(button('change')).not.toBeNull();
    expect(button('use-default')?.textContent?.trim()).toBe(`${KEY}.useDefault`);
  });

  it('is shown in every status, as an override can be set before the clone ends', async () => {
    await show(repositoryDetails({ status: 'cloning' }).summary, () => of(usingDefault));

    expect(author()).toBe('Commits use Ada <ada@example.com>');
    expect(button('change')).not.toBeNull();
  });

  it('opens the commit author dialog for the override only, from the author in use', async () => {
    await show(ready(), () => of(usingDefault));

    button('change')?.click();
    await settle(fixture);

    expect(open).toHaveBeenCalledExactlyOnceWith(ChangeCommitAuthorDialog, {
      data: { repositoryId: 7, current: usingDefault, overrideOnly: true }
    });
    expect(button('change')?.getAttribute('aria-disabled')).toBe('true');
  });

  it('opens one dialog for two quick presses', async () => {
    await show(ready(), () => of(usingDefault));

    button('change')?.click();
    button('change')?.click();
    await settle(fixture);

    expect(open).toHaveBeenCalledOnce();
  });

  it('shows the override once the dialog saved it', async () => {
    await show(ready(), () => of(usingDefault));

    button('change')?.click();
    closed.next(usingOverride);
    closed.complete();
    await settle(fixture);

    expect(source()).toBe('Only for this repository');
    expect(author()).toBe('Commits use Ada L <ada@work.example>');
  });

  it('cancelling the dialog changes nothing', async () => {
    await show(ready(), () => of(usingDefault));

    button('change')?.click();
    closed.complete();
    await settle(fixture);

    expect(author()).toBe('Commits use Ada <ada@example.com>');
    expect(requested).toEqual([ 7 ]);
    expect(api.removeRepositoryCommitAuthor).not.toHaveBeenCalled();
    expect(button('change')?.getAttribute('aria-disabled')).toBeNull();
  });

  it('Use my default removes the override without asking', async () => {
    await show(ready(), () => of(usingOverride));

    button('use-default')?.click();
    await settle(fixture);

    expect(api.removeRepositoryCommitAuthor).toHaveBeenCalledExactlyOnceWith(7);
    expect(open).not.toHaveBeenCalled();
    expect(source()).toBe('Your default commit author');
    expect(button('use-default')).toBeNull();
  });

  it('says why saving failed', async () => {
    await show(ready(), () => of(usingOverride));
    api.removeRepositoryCommitAuthor.mockReturnValue(throwError(() => apiFailure(500, 'internal')));

    button('use-default')?.click();
    await settle(fixture);

    const banner = host().querySelector('ui-inline-banner');
    expect(banner).not.toBeNull();
    expect(banner?.textContent).toContain('req-1');
    expect(source()).toBe('Only for this repository');
    expect(button('use-default')).not.toBeNull();
  });

  it('follows a change of the default elsewhere', async () => {
    await show(ready(), () => of(usingDefault), () => of({ ...usingDefault, author: work }));

    push.events.next({ type: 'commit-author.changed' });
    await settle(fixture);

    expect(requested).toEqual([ 7, 7 ]);
    expect(author()).toBe('Commits use Ada L <ada@work.example>');
    expect(source()).toBe('Your default commit author');
  });

  it('reads again after a reconnect', async () => {
    await show(ready(), () => of(usingDefault), () => of(usingOverride));

    push.reconnected.next();
    await settle(fixture);

    expect(source()).toBe('Only for this repository');
  });

  it('keeps the author shown when reading again fails', async () => {
    await show(ready(), () => of(usingDefault), () => throwError(() => apiFailure(500, 'internal')));

    push.events.next({ type: 'commit-author.changed' });
    await settle(fixture);

    expect(author()).toBe('Commits use Ada <ada@example.com>');
    expect(host().querySelector('.failed')).toBeNull();
  });

  it('offers Try again when the author could not be read', async () => {
    await show(ready(), () => throwError(() => apiFailure(500, 'internal')), () => of(usingDefault));

    expect(host().querySelector('.failed')?.textContent).toContain(`${KEY}.loadFailed`);
    expect(button('change')).toBeNull();

    button('retry')?.click();
    await settle(fixture);

    expect(author()).toBe('Commits use Ada <ada@example.com>');
  });

  it('leaves a repository that is gone to the page', async () => {
    await show(ready(), () => throwError(() => apiFailure(404, 'not-found')));

    expect(store.reload).toHaveBeenCalledOnce();
  });
});
