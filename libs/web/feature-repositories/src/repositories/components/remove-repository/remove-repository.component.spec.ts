import { Component } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import type { RepositorySummary } from '@front-burner/shared-contracts';
import { DialogService, ToastService } from '@front-burner/ui';
import { DraftStore } from '@front-burner/web-core';
import { of, Subject } from 'rxjs';

import { repositoryDetails } from '../../../testing/repository-details';
import { settle } from '../../../testing/settle';
import { translocoTesting } from '../../../testing/transloco-testing';
import { RemoveRepositoryDialog } from '../../dialogs/remove-repository/remove-repository.dialog';
import { RemoveRepositoryComponent } from './remove-repository.component';

const K = 'web-feature-repositories.RemoveRepositoryComponent';

@Component({ template: '' })
class ListPage {}

describe('RemoveRepositoryComponent', () => {
  let fixture: ComponentFixture<RemoveRepositoryComponent>;
  let closed: Subject<boolean | undefined>;
  let open: ReturnType<typeof vi.fn>;
  let deleteRepository: ReturnType<typeof vi.fn>;
  let show: ReturnType<typeof vi.fn>;
  /** Whether going to the list may go on; the route waits for it. */
  let gate: Promise<boolean>;

  const removeButton = () => (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('button.remove');

  async function render(summary: RepositorySummary = repositoryDetails().summary): Promise<void> {
    fixture = TestBed.createComponent(RemoveRepositoryComponent);
    fixture.componentRef.setInput('repository', summary);
    await settle(fixture);
  }

  beforeEach(() => {
    closed = new Subject();
    open = vi.fn(() => ({ closed }));
    deleteRepository = vi.fn(() => Promise.resolve());
    show = vi.fn();
    gate = Promise.resolve(true);
    TestBed.configureTestingModule({
      imports: [ translocoTesting({ [`${K}.removed`]: 'Repository {{ name }} removed.' }) ],
      providers: [
        provideRouter([ { path: 'repositories', component: ListPage, canActivate: [ () => gate ] } ]),
        { provide: DialogService, useValue: { open } },
        { provide: DraftStore, useValue: { deleteRepository } },
        { provide: ToastService, useValue: { show } }
      ]
    });
  });

  it('is offered in every status, with the text of RM-17', async () => {
    await render(repositoryDetails({ status: 'cloning' }).summary);

    expect(fixture.nativeElement.textContent).toContain(`${K}.description`);
    expect(removeButton()?.textContent?.trim()).toBe(`${K}.remove`);
    expect(removeButton()?.getAttribute('data-variant')).toBe('danger');
  });

  it('opens the dialog for the repository', async () => {
    await render();

    removeButton()?.click();
    await settle(fixture);

    expect(open).toHaveBeenCalledWith(RemoveRepositoryDialog, { data: { id: 7, name: 'handbook' } });
    expect(removeButton()?.getAttribute('data-busy')).toBe('true');
    removeButton()?.click();
    expect(open).toHaveBeenCalledOnce();
  });

  it('goes to the repository management page with the message', async () => {
    await render();
    const router = TestBed.inject(Router);

    removeButton()?.click();
    closed.next(true);
    closed.complete();
    await settle(fixture);

    expect(deleteRepository).toHaveBeenCalledWith(7);
    expect(show).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Repository handbook removed.',
      status: 'success'
    }));
    expect(router.url).toBe('/repositories');
  });

  it('cancelling changes nothing', async () => {
    await render();
    const router = TestBed.inject(Router);

    removeButton()?.click();
    closed.next(false);
    closed.complete();
    await settle(fixture);

    expect(deleteRepository).not.toHaveBeenCalled();
    expect(show).not.toHaveBeenCalled();
    expect(router.url).toBe('/');
    expect(removeButton()?.hasAttribute('data-busy')).toBe(false);
  });

  it('goes to the list without waiting for the drafts to be deleted', async () => {
    // Such as IndexedDB that never answers.
    deleteRepository.mockReturnValue(new Promise<void>(() => undefined));
    await render();
    const router = TestBed.inject(Router);

    open.mockReturnValue({ closed: of(true) });
    removeButton()?.click();
    await settle(fixture);

    expect(deleteRepository).toHaveBeenCalledWith(7);
    expect(show).toHaveBeenCalledOnce();
    expect(router.url).toBe('/repositories');
  });

  it('stays busy until it has gone to the list, so that a second press does nothing', async () => {
    let pass: (go: boolean) => void = () => undefined;
    gate = new Promise(resolve => (pass = resolve));
    await render();
    const router = TestBed.inject(Router);

    // `settle` would wait for the held navigation, so this waits for the timers and renders by hand.
    const tick = async () => {
      await new Promise(resolve => setTimeout(resolve));
      fixture.detectChanges();
    };

    open.mockReturnValue({ closed: of(true) });
    removeButton()?.click();
    await tick();
    expect(router.url).toBe('/');
    expect(removeButton()?.getAttribute('data-busy')).toBe('true');

    removeButton()?.click();
    await tick();
    expect(open).toHaveBeenCalledOnce();
    expect(show).toHaveBeenCalledOnce();

    pass(true);
    await settle(fixture);
    expect(router.url).toBe('/repositories');
  });
});
