import { HttpErrorResponse } from '@angular/common/http';
import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { RemovalCheckResult } from '@front-burner/shared-contracts';
import { type DialogRef, DialogService } from '@front-burner/ui';
import { RepositoriesApi } from '@front-burner/web-api-client';
import { RemovedRepositoriesService } from '@front-burner/web-core';
import { firstValueFrom, NEVER, type Observable, of, throwError } from 'rxjs';

import { apiFailure } from '../../../testing/api-failure';
import { button, type } from '../../../testing/form-testing';
import { translocoTesting } from '../../../testing/transloco-testing';
import { type RemoveRepositoryData, RemoveRepositoryDialog } from './remove-repository.dialog';

const K = 'web-feature-repositories.RemoveRepositoryDialog';

const nothing: RemovalCheckResult = {
  uncommittedFiles: 0,
  unpushedCommits: 0,
  stashes: 0,
  mergeInProgress: false,
  unreadable: false
};

describe('RemoveRepositoryDialog', () => {
  let ref: DialogRef<boolean>;
  /** How the dialog that {@link open} opened closes. */
  let closed: Promise<boolean | undefined>;
  let checks: (() => Observable<RemovalCheckResult>)[];
  let removeAnswer: () => Observable<void>;
  let removed: { id: number; query: { confirmName?: string; } | undefined; }[];
  /** `RemovedRepositoriesService.expect`, and what it returns. */
  let expectRemoval: ReturnType<typeof vi.fn>;
  let notRemoving: ReturnType<typeof vi.fn>;

  const overlay = () => document.querySelector('.cdk-overlay-container') as HTMLElement;
  const heading = () => overlay().querySelector('h2')?.textContent?.trim();
  const losses = () => [ ...overlay().querySelectorAll('.losses li') ].map(item => item.textContent?.trim());
  const nameField = () => overlay().querySelector<HTMLInputElement>('ui-field input');
  const removeButton = () => button(overlay(), `${K}.remove`);
  const banner = () => overlay().querySelector('ui-inline-banner')?.textContent?.trim();

  async function settle(): Promise<void> {
    await new Promise(resolve => setTimeout(resolve));
    await TestBed.inject(ApplicationRef).whenStable();
    await new Promise(resolve => setTimeout(resolve));
  }

  async function open(...answers: (() => Observable<RemovalCheckResult>)[]): Promise<void> {
    checks = answers;
    ref = TestBed.inject(DialogService).open<RemoveRepositoryDialog, RemoveRepositoryData, boolean>(
      RemoveRepositoryDialog,
      { data: { id: 7, name: 'handbook' } }
    );
    closed = firstValueFrom(ref.closed, { defaultValue: undefined });
    await settle();
  }

  async function press(element: HTMLElement | undefined | null): Promise<void> {
    element?.click();
    await settle();
  }

  beforeEach(() => {
    removeAnswer = () => of(undefined);
    removed = [];
    notRemoving = vi.fn();
    expectRemoval = vi.fn(() => notRemoving);
    TestBed.configureTestingModule({
      imports: [
        translocoTesting({
          [`${K}.heading`]: 'Remove {{ name }}?',
          [`${K}.losses.uncommitted`]: '{{ count }} uncommitted files',
          [`${K}.losses.unpushed`]: '{{ count }} commits not pushed',
          [`${K}.losses.stashes`]: '{{ count }} stashes',
          [`${K}.typeName`]: 'Type {{ name }} to confirm'
        })
      ],
      providers: [
        {
          provide: RepositoriesApi,
          useValue: {
            removalCheck: () => (checks.shift() ?? (() => NEVER))(),
            remove: (id: number, query?: { confirmName?: string; }) => {
              removed.push({ id, query });
              return removeAnswer();
            }
          }
        },
        { provide: RemovedRepositoriesService, useValue: { expect: expectRemoval } }
      ]
    });
  });

  afterEach(() => TestBed.inject(DialogService).closeAll());

  it('removes with one click when nothing would be lost', async () => {
    await open(() => of(nothing));

    expect(heading()).toBe('Remove handbook?');
    expect(overlay().textContent).toContain(`${K}.message`);
    expect(nameField()).toBeNull();
    await press(removeButton());

    expect(removed).toEqual([ { id: 7, query: undefined } ]);
    expect(await closed).toBe(true);
  });

  it('lists the work that would be lost and asks for the name', async () => {
    await open(() => of({ ...nothing, uncommittedFiles: 2, unpushedCommits: 3, stashes: 1 }));

    expect(losses()).toEqual([ '2 uncommitted files', '3 commits not pushed', '1 stashes' ]);
    expect(overlay().querySelector('ui-field')?.textContent).toContain('Type handbook to confirm');
    expect(nameField()).not.toBeNull();
  });

  it('lists a merge in progress', async () => {
    await open(() => of({ ...nothing, mergeInProgress: true }));

    expect(losses()).toEqual([ `${K}.losses.merge` ]);
    expect(nameField()).not.toBeNull();
  });

  it('asks for the name for an unreadable working copy', async () => {
    await open(() => of({ ...nothing, unreadable: true }));

    expect(losses()).toEqual([]);
    expect(overlay().querySelector('.unreadable')?.textContent?.trim()).toBe(`${K}.unreadable`);
    expect(nameField()).not.toBeNull();
  });

  it('enables Remove only when the name matches', async () => {
    await open(() => of({ ...nothing, uncommittedFiles: 2 }));

    expect(removeButton()?.getAttribute('aria-disabled')).toBe('true');
    await press(removeButton());
    expect(removed).toEqual([]);

    type(nameField() as HTMLInputElement, 'Handbook');
    await settle();
    expect(removeButton()?.getAttribute('aria-disabled')).toBe('true');

    type(nameField() as HTMLInputElement, ' handbook ');
    await settle();
    expect(removeButton()?.hasAttribute('aria-disabled')).toBe(false);
    await press(removeButton());

    expect(removed).toEqual([ { id: 7, query: { confirmName: ' handbook ' } } ]);
    expect(await closed).toBe(true);
  });

  it('asks for the name when work appeared since', async () => {
    const appeared = { ...nothing, uncommittedFiles: 2, unpushedCommits: 3 };
    removeAnswer = () =>
      throwError(() =>
        new HttpErrorResponse({
          status: 409,
          error: { code: 'removal-needs-confirmation', params: appeared, requestId: 'req-1', message: 'confirm' }
        })
      );
    await open(() => of(nothing));

    expect(overlay().querySelector('ui-inline-banner.appeared')).toBeNull();
    removeButton()?.focus();
    await press(removeButton());

    // Not a failure: a warning, announced, and the focus on the field that makes Remove available.
    expect(overlay().querySelector('ui-inline-banner[status="danger"]')).toBeNull();
    const warning = overlay().querySelector('ui-inline-banner.appeared');
    expect(warning?.textContent?.trim()).toBe(`${K}.appeared`);
    expect(warning?.hasAttribute('announce')).toBe(true);
    expect(losses()).toEqual([ '2 uncommitted files', '3 commits not pushed' ]);
    expect(nameField()).not.toBeNull();
    expect(document.activeElement).toBe(nameField());
    expect(removeButton()?.getAttribute('aria-disabled')).toBe('true');

    removeAnswer = () => of(undefined);
    type(nameField() as HTMLInputElement, 'handbook');
    await settle();
    await press(removeButton());
    expect(removed.at(-1)).toEqual({ id: 7, query: { confirmName: 'handbook' } });
  });

  it('says why removing failed', async () => {
    removeAnswer = () => throwError(() => new HttpErrorResponse({ status: 0 }));
    let result: boolean | undefined = undefined;
    await open(() => of(nothing));
    void closed.then(value => (result = value));

    await press(removeButton());

    expect(banner()).toBeTruthy();
    expect(result).toBeUndefined();
    expect(heading()).toBe('Remove handbook?');
    expect(removeButton()).toBeDefined();
  });

  it('ignores its own removal: announces it before the request, which its event may overtake', async () => {
    removeAnswer = () => {
      expect(expectRemoval).toHaveBeenCalledWith(7);
      return of(undefined);
    };
    await open(() => of(nothing));

    await press(removeButton());

    expect(removed).toHaveLength(1);
    expect(notRemoving).not.toHaveBeenCalled();
  });

  it('follows a removal elsewhere again once its own failed', async () => {
    removeAnswer = () => throwError(() => new HttpErrorResponse({ status: 0 }));
    await open(() => of(nothing));

    await press(removeButton());

    expect(notRemoving).toHaveBeenCalledTimes(1);
  });

  it('counts a repository that is gone already as removed', async () => {
    removeAnswer = () => throwError(() => apiFailure(404, 'not-found'));
    await open(() => of(nothing));

    await press(removeButton());

    expect(await closed).toBe(true);
  });

  it('offers Try again when the check failed', async () => {
    await open(() => throwError(() => apiFailure(500, 'internal')), () => of(nothing));

    expect(removeButton()).toBeUndefined();
    await press(button(overlay(), `${K}.retry`));

    expect(removeButton()).toBeDefined();
  });

  it('cancelling changes nothing', async () => {
    await open(() => of({ ...nothing, uncommittedFiles: 2 }));

    await press(button(overlay(), `${K}.cancel`));

    expect(removed).toEqual([]);
    expect(await closed).toBe(false);
  });

  it('focuses Cancel first', async () => {
    await open(() => of({ ...nothing, uncommittedFiles: 2 }));

    expect(document.activeElement).toBe(button(overlay(), `${K}.cancel`));
  });
});
