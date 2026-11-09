import { TestBed } from '@angular/core/testing';
import type { GitNewBranchRequest } from '@front-burner/shared-contracts';
import { DialogRef, DialogService } from '@front-burner/ui';
import { GitApi } from '@front-burner/web-api-client';
import { firstValueFrom, type Observable, of, Subject, throwError } from 'rxjs';

import { apiError, dialogButton, nameInput, overlay, settleDialog, type } from '../../../testing/dialog-testing';
import { translocoTesting } from '../../../testing/transloco-testing';
import { OpenFilesService } from '../../services/open-files/open-files.service';
import { type NewBranchData, NewBranchDialog } from './new-branch.dialog';

const K = 'web-feature-repository-screen.NewBranchDialog';

describe('NewBranchDialog', () => {
  let ref: DialogRef<void>;
  let created: GitNewBranchRequest[];
  let createAnswer: () => Observable<void>;
  let saveWaitingCalls: number;
  let saveWaitingPromise: Promise<void>;

  const heading = () => overlay().querySelector('h2')?.textContent?.trim();
  const error = () => overlay().querySelector('ui-field .error')?.textContent?.trim();
  const banners = () =>
    [ ...overlay().querySelectorAll('ui-inline-banner') ].map(banner => [
      banner.getAttribute('data-status'),
      banner.textContent?.trim()
    ]);

  async function open(data: Partial<NewBranchData> = {}): Promise<void> {
    ref = TestBed.inject(DialogService).open<NewBranchDialog, NewBranchData, void>(NewBranchDialog, {
      data: {
        repositoryId: 12,
        saveWaiting: () => {
          saveWaitingCalls++;
          return saveWaitingPromise;
        },
        ...data
      }
    });
    await settleDialog();
  }

  async function submit(): Promise<void> {
    dialogButton(`${K}.submit`)?.click();
    await settleDialog();
  }

  beforeEach(() => {
    created = [];
    createAnswer = () => of(undefined);
    saveWaitingCalls = 0;
    saveWaitingPromise = Promise.resolve();
    TestBed.configureTestingModule({
      imports: [
        translocoTesting({
          'errors.git-busy': 'Git is busy.',
          'errors.internal': 'Something went wrong.',
          [`${K}.errors.branch-name-invalid`]: 'This isn\'t a valid branch name.',
          [`${K}.errors.branch-exists`]: 'A branch with this name already exists.',
          [`${K}.errors.branch-name-conflict`]: 'This name clashes with another branch\'s name.'
        })
      ],
      providers: [
        {
          provide: GitApi,
          useValue: {
            createBranch: (_id: number, request: GitNewBranchRequest) => {
              created.push(request);
              return createAnswer();
            }
          }
        }
      ]
    });
  });

  afterEach(() => TestBed.inject(DialogService).closeAll());

  it('renders heading and focuses the name input', async () => {
    await open();

    expect(heading()).toBe(`${K}.heading`);
    expect(document.activeElement).toBe(nameInput());
  });

  it('creates a new branch, trimming surrounding whitespace and flushing waiting saves', async () => {
    await open();
    const closed = firstValueFrom(ref.closed, { defaultValue: undefined });

    type(nameInput(), '  feature/new-work  ');
    await submit();

    expect(saveWaitingCalls).toBe(1);
    expect(created).toEqual([ { name: 'feature/new-work' } ]);
    expect(await closed).toBeUndefined();
    expect(overlay().querySelector('rs-new-branch')).toBeNull();
  });

  it('shows field-level error for branch-name-invalid and keeps focus and text', async () => {
    createAnswer = () => throwError(() => apiError(400, 'branch-name-invalid'));
    await open();

    type(nameInput(), 'bad..name');
    await submit();

    expect(created).toEqual([ { name: 'bad..name' } ]);
    expect(error()).toBe('This isn\'t a valid branch name.');
    expect(nameInput().value).toBe('bad..name');
    expect(document.activeElement).toBe(nameInput());
    expect(overlay().querySelector('rs-new-branch')).not.toBeNull();
  });

  it('shows field-level error for branch-exists and keeps focus and text', async () => {
    createAnswer = () => throwError(() => apiError(409, 'branch-exists'));
    await open();

    type(nameInput(), 'main');
    await submit();

    expect(created).toEqual([ { name: 'main' } ]);
    expect(error()).toBe('A branch with this name already exists.');
    expect(nameInput().value).toBe('main');
    expect(document.activeElement).toBe(nameInput());
  });

  it('shows field-level error for branch-name-conflict and keeps focus and text', async () => {
    createAnswer = () => throwError(() => apiError(409, 'branch-name-conflict'));
    await open();

    type(nameInput(), 'feature/sub');
    await submit();

    expect(created).toEqual([ { name: 'feature/sub' } ]);
    expect(error()).toBe('This name clashes with another branch\'s name.');
    expect(nameInput().value).toBe('feature/sub');
    expect(document.activeElement).toBe(nameInput());
  });

  it('clears field error when typed name changes', async () => {
    createAnswer = () => throwError(() => apiError(400, 'branch-name-invalid'));
    await open();

    type(nameInput(), 'bad..name');
    await submit();

    expect(error()).toBe('This isn\'t a valid branch name.');

    type(nameInput(), 'good-name');
    await settleDialog();

    expect(error()).toBeUndefined();
  });

  it('shows inline banner for git-busy and general errors', async () => {
    createAnswer = () => throwError(() => apiError(409, 'git-busy'));
    await open();

    type(nameInput(), 'feature');
    await submit();

    expect(error()).toBeUndefined();
    expect(banners()[0][0]).toBe('danger');
    expect(banners()[0][1]).toContain('Git is busy.');
  });

  it('prevents concurrent double submit while request is in flight', async () => {
    const answer = new Subject<void>();
    createAnswer = () => answer;
    await open();

    type(nameInput(), 'feature');

    const submitBtn = dialogButton(`${K}.submit`);
    submitBtn?.click();
    submitBtn?.click();
    await settleDialog();

    expect(created).toHaveLength(1);
    expect(saveWaitingCalls).toBe(1);

    answer.next();
    answer.complete();
    await settleDialog();

    expect(created).toHaveLength(1);
    expect(overlay().querySelector('rs-new-branch')).toBeNull();
  });

  it('closes dialog on cancel click', async () => {
    await open();
    const closed = firstValueFrom(ref.closed, { defaultValue: undefined });

    dialogButton(`${K}.cancel`)?.click();
    await settleDialog();

    expect(await closed).toBeUndefined();
    expect(overlay().querySelector('rs-new-branch')).toBeNull();
    expect(created).toHaveLength(0);
  });
});
