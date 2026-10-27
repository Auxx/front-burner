import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CredentialsApi } from '@front-burner/web-api-client';

import { FormHostComponent, hostWith } from '../../../testing/form-host';
import { button, choose, field, radio, radioLabels, selectValue } from '../../../testing/form-testing';
import { settle } from '../../../testing/settle';
import { translocoTesting } from '../../../testing/transloco-testing';
import { BranchListService, type BranchListState } from '../../services/branch-list/branch-list.service';
import { CloneSectionComponent } from './clone-section.component';

const KEY = 'web-feature-repositories.CloneSectionComponent';
const ERRORS = 'web-feature-repositories.errors';

describe('CloneSectionComponent', () => {
  let fixture: ComponentFixture<FormHostComponent>;
  let branches: { state: ReturnType<typeof signal<BranchListState>>; retry: ReturnType<typeof vi.fn>; };

  const page = () => fixture.nativeElement as HTMLElement;
  const host = () => fixture.componentInstance;
  const understood = () => page().querySelector<HTMLInputElement>('input[type=checkbox]');

  async function open(state: BranchListState = { kind: 'idle' }): Promise<void> {
    branches = { state: signal(state), retry: vi.fn() };
    hostWith(
      `<repo-clone-section
        [cloneMode]="model.cloneMode"
        [branch]="model.branch"
        [understood]="model.understood"
      />`,
      [ CloneSectionComponent ]
    );
    await TestBed.configureTestingModule({
      imports: [ FormHostComponent, translocoTesting() ],
      providers: [ { provide: CredentialsApi, useValue: {} }, { provide: BranchListService, useValue: branches } ]
    }).compileComponents();
    fixture = TestBed.createComponent(FormHostComponent);
    await settle(fixture);
  }

  async function chooseSingleBranch(): Promise<void> {
    choose(page(), `${KEY}.modes.single-branch`);
    await settle(fixture);
  }

  it('offers a full clone, by default, and a single branch, with their descriptions', async () => {
    await open();

    expect(radioLabels(page())).toEqual([ `${KEY}.modes.full`, `${KEY}.modes.single-branch` ]);
    expect(radio(page(), `${KEY}.modes.full`)?.checked).toBe(true);
    expect(page().textContent).toContain(`${KEY}.descriptions.full`);
    expect(page().textContent).toContain(`${KEY}.descriptions.single-branch`);
    expect(page().querySelector('ui-field')).toBeNull();
  });

  it('asks for the branch and the warning\'s checkbox for a single branch', async () => {
    await open({ kind: 'loaded', branches: [ 'feature/x', 'main' ], defaultBranch: 'main' });

    await chooseSingleBranch();

    expect(field(page(), `${KEY}.branch`)).toBeTruthy();
    expect(page().querySelector('ui-inline-banner')?.textContent).toContain(`${KEY}.warning`);
    expect(understood()?.closest('label')?.textContent?.trim()).toBe(`${KEY}.understood`);
    expect(host().model().invalid()).toBe(true);
    expect(host().model.understood().invalid()).toBe(true);
    understood()?.click();
    await settle(fixture);
    expect(host().model.understood().invalid()).toBe(false);
  });

  it('preselects the remote\'s default branch', async () => {
    await open();
    await chooseSingleBranch();

    branches.state.set({ kind: 'loaded', branches: [ 'feature/x', 'main' ], defaultBranch: 'main' });
    await settle(fixture);

    expect(host().model.branch().value()).toBe('main');
    expect(selectValue(page(), `${KEY}.branch`)).toBe('main');
    expect(host().model.branch().invalid()).toBe(false);
  });

  it('keeps a chosen branch that the new list still has', async () => {
    await open({ kind: 'loaded', branches: [ 'feature/x', 'main' ], defaultBranch: 'main' });
    await chooseSingleBranch();
    host().model.branch().value.set('feature/x');

    branches.state.set({ kind: 'loaded', branches: [ 'feature/x', 'main', 'next' ], defaultBranch: 'main' });
    await settle(fixture);

    expect(host().model.branch().value()).toBe('feature/x');
  });

  it('shows a loading state', async () => {
    await open({ kind: 'loading' });

    await chooseSingleBranch();

    expect(selectValue(page(), `${KEY}.branch`)).toBe(`${KEY}.loading`);
  });

  it('shows the error with Try again', async () => {
    await open({
      kind: 'failed',
      error: { code: 'remote-timeout', params: { host: 'github.com' }, requestId: 'r', message: 'm' }
    });
    await chooseSingleBranch();

    expect(field(page(), `${KEY}.branch`).querySelector('.error')?.textContent?.trim()).toBe(
      `${ERRORS}.form.remote-timeout`
    );
    button(page(), `${KEY}.retry`)?.click();

    expect(branches.retry).toHaveBeenCalled();
  });

  it('says an empty remote has no branches', async () => {
    await open({ kind: 'loaded', branches: [], defaultBranch: null });

    await chooseSingleBranch();

    expect(selectValue(page(), `${KEY}.branch`)).toBe(`${KEY}.noBranches`);
    expect(host().model.branch().invalid()).toBe(true);
  });
});
