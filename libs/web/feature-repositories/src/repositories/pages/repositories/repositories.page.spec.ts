import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { PushEvent, RepositoryList, RepositorySummary } from '@front-burner/shared-contracts';
import { RepositoriesApi } from '@front-burner/web-api-client';
import { PushChannelService } from '@front-burner/web-core';
import { NEVER, Observable, of, Subject, throwError } from 'rxjs';

import { settle } from '../../../testing/settle';
import { translocoTesting } from '../../../testing/transloco-testing';
import { RepositoriesPage } from './repositories.page';

const KEY = 'web-feature-repositories.RepositoriesPage';

function summary(id: number, name: string, remote: string, extra: Partial<RepositorySummary> = {}): RepositorySummary {
  return {
    id,
    name,
    remote,
    status: 'ready',
    error: null,
    warnings: [],
    clone: null,
    lastAccessedAt: '2026-10-26T10:00:00.000Z',
    ...extra
  };
}

const handbook = summary(1, 'handbook', 'github.com/acme/handbook');
const notes = summary(2, 'Notes', 'bitbucket.org/ada/journal');
const specs = summary(3, 'specs', 'github.com/acme/specs', { status: 'cloning' });

describe('RepositoriesPage', () => {
  let fixture: ComponentFixture<RepositoriesPage>;
  let responses: Observable<RepositoryList>[];
  let push: { events: Subject<PushEvent>; reconnected: Subject<void>; };
  let requests: number;

  const page = () => fixture.nativeElement as HTMLElement;
  const guide = () => page().querySelector('shell-add-repository-guide');
  const entries = () => [ ...page().querySelectorAll('repo-repository-list-entry') ];
  const names = () => entries().map(entry => entry.querySelector('a.name')?.textContent?.trim());
  const filter = () => page().querySelector<HTMLInputElement>('input[type="search"]');
  const live = () => page().querySelector('[aria-live="polite"]')?.textContent?.trim();
  const addLink = () => page().querySelector('a.add');
  const retry = () =>
    [ ...page().querySelectorAll('button') ].find(button => button.textContent?.trim() === `${KEY}.retry`);

  async function open(...answers: Observable<RepositoryList>[]): Promise<void> {
    responses = answers;
    requests = 0;
    const list = () => {
      requests++;
      return responses.shift() ?? NEVER;
    };
    await TestBed.configureTestingModule({
      imports: [ RepositoriesPage, translocoTesting() ],
      providers: [
        provideRouter([]),
        { provide: RepositoriesApi, useValue: { list } },
        { provide: PushChannelService, useValue: push }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(RepositoriesPage);
    await settle(fixture);
  }

  async function type(text: string): Promise<void> {
    const input = filter() as HTMLInputElement;
    input.value = text;
    input.dispatchEvent(new Event('input'));
    await settle(fixture);
  }

  beforeEach(() => {
    push = { events: new Subject(), reconnected: new Subject() };
  });

  it('has one h1, "Repositories"', async () => {
    await open(of({ repositories: [ handbook ] }));

    expect(page().querySelectorAll('h1')).toHaveLength(1);
    expect(page().querySelector('h1')?.textContent?.trim()).toBe(`${KEY}.heading`);
  });

  it('keeps the order of the response', async () => {
    await open(of({ repositories: [ specs, handbook, notes ] }));

    expect(names()).toEqual([ 'specs', 'handbook', 'Notes' ]);
  });

  it('offers Add repository, to the Add repository page', async () => {
    await open(of({ repositories: [ handbook ] }));

    expect(addLink()?.getAttribute('href')).toBe('/repositories/new');
    expect(addLink()?.textContent?.trim()).toBe(`${KEY}.add`);
  });

  it('filters by name and remote', async () => {
    await open(of({ repositories: [ handbook, notes, specs ] }));

    expect(filter()?.closest('ui-field')).not.toBeNull();
    expect(live()).toBe('');

    await type('NOTES');
    expect(names()).toEqual([ 'Notes' ]);
    expect(live()).toBe(`${KEY}.matches`);

    await type('acme');
    expect(names()).toEqual([ 'handbook', 'specs' ]);

    await type('  JOURNAL ');
    expect(names()).toEqual([ 'Notes' ]);

    await type('');
    expect(names()).toEqual([ 'handbook', 'Notes', 'specs' ]);
    expect(live()).toBe('');
    expect(requests).toBe(1);
  });

  it('says when nothing matches', async () => {
    await open(of({ repositories: [ handbook ] }));

    await type('zzz');

    expect(entries()).toHaveLength(0);
    expect(page().querySelector('.no-match')?.textContent?.trim()).toBe(`${KEY}.noMatch`);
    expect(live()).toBe(`${KEY}.matches`);
  });

  it('shows the guide without repositories', async () => {
    await open(of({ repositories: [] }));

    expect(guide()?.getAttribute('data-form')).toBe('full');
    expect(filter()).toBeNull();
    expect(page().querySelector('ul')).toBeNull();
    expect(addLink()).toBeNull();
  });

  it('offers Open only for openable repositories', async () => {
    await open(of({ repositories: [ handbook, specs ] }));

    expect(entries().map(entry => entry.querySelector('a.open') !== null)).toEqual([ true, false ]);
  });

  it('shows a spinner while loading', async () => {
    await open(NEVER);

    expect(page().querySelector('ui-spinner')).not.toBeNull();
    expect(guide()).toBeNull();
    expect(filter()).toBeNull();
  });

  it('shows a failed load with Try again', async () => {
    await open(throwError(() => new Error('down')), of({ repositories: [ handbook ] }));

    expect(page().querySelector('ui-inline-banner')?.textContent).toContain(`${KEY}.loadFailed`);
    expect(entries()).toHaveLength(0);

    retry()?.click();
    await settle(fixture);

    expect(page().querySelector('ui-inline-banner')).toBeNull();
    expect(names()).toEqual([ 'handbook' ]);
  });

  it('follows a clone without a reload, keeping the filter', async () => {
    await open(of({ repositories: [ handbook, specs ] }));
    await type('specs');

    push.events.next({ type: 'repository.status', repositoryId: specs.id, status: 'ready', error: null });
    await settle(fixture);

    expect(names()).toEqual([ 'specs' ]);
    expect(entries()[0].querySelector('a.open')).not.toBeNull();
    expect(requests).toBe(1);
  });

  it('loads the list again for a repository it does not list', async () => {
    await open(of({ repositories: [ handbook ] }), of({ repositories: [ handbook, notes ] }));

    push.events.next({ type: 'repository.status', repositoryId: notes.id, status: 'cloning', error: null });
    await settle(fixture);

    expect(names()).toEqual([ 'handbook', 'Notes' ]);
  });
});
