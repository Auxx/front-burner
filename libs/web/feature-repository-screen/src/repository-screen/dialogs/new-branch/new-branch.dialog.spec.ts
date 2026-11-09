import { TestBed } from '@angular/core/testing';
import type { ApiError, GitBranchList, GitNewBranchRequest } from '@front-burner/shared-contracts';
import { DialogRef, DialogService } from '@front-burner/ui';
import { GitApi } from '@front-burner/web-api-client';
import { firstValueFrom, type Observable, of, Subject, throwError } from 'rxjs';

import { apiError, dialogButton, nameInput, overlay, settleDialog, type } from '../../../testing/dialog-testing';
import { translocoTesting } from '../../../testing/transloco-testing';
import { type NewBranchData, NewBranchDialog } from './new-branch.dialog';

const K = 'web-feature-repository-screen.NewBranchDialog';

describe('NewBranchDialog', () => {
  let ref: DialogRef<void>;
  let created: GitNewBranchRequest[];
  let createAnswer: () => Observable<void>;
  let currentBranch: string | null;
  let saveWaitingCalls: number;
  let saveWaitingPromise: Promise<ApiError | null>;

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
        currentBranch: 'main',
        stillOn: () => true,
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
    currentBranch = 'main';
    saveWaitingCalls = 0;
    saveWaitingPromise = Promise.resolve(null);
    TestBed.configureTestingModule({
      imports: [
        translocoTesting({
          'errors.git-busy': 'Git is busy.',
          'errors.internal': 'Something went wrong.',
          'errors.draft-offered': 'Draft is offered.',
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
            },
            gitBranches: (): Observable<GitBranchList> =>
              of({ current: currentBranch, singleBranch: false, local: [], remote: [] })
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

  it('sends a waiting save first before calling createBranch', async () => {
    let resolveSave!: (value: ApiError | null) => void;
    saveWaitingPromise = new Promise(resolve => {
      resolveSave = resolve;
    });

    await open();

    type(nameInput(), 'feature');
    dialogButton(`${K}.submit`)?.click();
    await settleDialog();

    expect(saveWaitingCalls).toBe(1);
    expect(created).toHaveLength(0);

    resolveSave(null);
    await settleDialog();

    expect(created).toEqual([ { name: 'feature' } ]);
    expect(overlay().querySelector('rs-new-branch')).toBeNull();
  });

  it('shows error banner when waiting save fails and stops before createBranch', async () => {
    saveWaitingPromise = Promise.resolve({
      code: 'draft-offered',
      message: 'Draft is offered.',
      params: {},
      requestId: ''
    });

    await open();

    type(nameInput(), 'feature');
    await submit();

    expect(saveWaitingCalls).toBe(1);
    expect(created).toHaveLength(0);
    expect(banners()[0][0]).toBe('danger');
    expect(banners()[0][1]).toContain('Draft is offered.');
    expect(overlay().querySelector('rs-new-branch')).not.toBeNull();
  });

  it('does not send createBranch when stillOn becomes false during save flush', async () => {
    let on = true;
    await open({
      stillOn: () => on
    });

    type(nameInput(), 'feature');
    on = false;
    await submit();

    expect(saveWaitingCalls).toBe(1);
    expect(created).toHaveLength(0);
  });

  it('closes dialog if createBranch failed but branch was created', async () => {
    createAnswer = () => throwError(() => apiError(500, 'internal'));
    currentBranch = 'feature';
    await open();
    const closed = firstValueFrom(ref.closed, { defaultValue: undefined });

    type(nameInput(), 'feature');
    await submit();

    expect(await closed).toBeUndefined();
    expect(overlay().querySelector('rs-new-branch')).toBeNull();
  });

  it('closes dialog if branch-exists error occurs but branch is already current', async () => {
    createAnswer = () => throwError(() => apiError(409, 'branch-exists'));
    currentBranch = 'feature';
    await open();
    const closed = firstValueFrom(ref.closed, { defaultValue: undefined });

    type(nameInput(), 'feature');
    await submit();

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
    currentBranch = 'main';
    await open();

    type(nameInput(), 'existing');
    await submit();

    expect(created).toEqual([ { name: 'existing' } ]);
    expect(error()).toBe('A branch with this name already exists.');
    expect(nameInput().value).toBe('existing');
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
