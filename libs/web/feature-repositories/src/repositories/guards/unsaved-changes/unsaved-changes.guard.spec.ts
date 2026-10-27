import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { provideRouter } from '@angular/router';
import type { GeneratedSshKey } from '@front-burner/shared-contracts';
import { DialogService } from '@front-burner/ui';
import { CredentialsApi, RepositoriesApi } from '@front-burner/web-api-client';
import { CurrentUserService } from '@front-burner/web-core';
import { of } from 'rxjs';

import { button, choose, control, type } from '../../../testing/form-testing';
import { settle } from '../../../testing/settle';
import { translocoTesting } from '../../../testing/transloco-testing';
import { AddRepositoryPage } from '../../pages/add-repository/add-repository.page';
import { unsavedChangesGuard } from './unsaved-changes.guard';

const REPOS = 'web-feature-repositories';

const generated: GeneratedSshKey = {
  key: {
    id: 9,
    name: 'Front Burner',
    keyType: 'ed25519',
    fingerprint: 'SHA256:generated',
    passphraseProtected: false,
    unlocked: false,
    generated: true,
    missing: false
  },
  publicKey: 'ssh-ed25519 AAAA front-burner@example.com'
};

describe('unsavedChangesGuard', () => {
  let fixture: ComponentFixture<AddRepositoryPage>;
  let confirm: ReturnType<typeof vi.fn>;

  const page = () => fixture.nativeElement as HTMLElement;

  async function open(): Promise<void> {
    confirm = vi.fn(() => Promise.resolve(false));
    await TestBed.configureTestingModule({
      imports: [ AddRepositoryPage, translocoTesting() ],
      providers: [
        provideRouter([]),
        { provide: RepositoriesApi, useValue: { index: () => of({ repositories: [] }) } },
        {
          provide: CredentialsApi,
          useValue: { list: () => of({ https: [], sshKeys: [] }), generateSshKey: () => of(generated) }
        },
        { provide: CurrentUserService, useValue: { load: () => new Promise(() => undefined) } },
        { provide: DialogService, useValue: { confirm } }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(AddRepositoryPage);
    await settle(fixture);
  }

  function leave(): boolean | Promise<boolean> {
    return TestBed.runInInjectionContext(() =>
      unsavedChangesGuard(
        fixture.componentInstance,
        {} as ActivatedRouteSnapshot,
        {} as RouterStateSnapshot,
        {} as RouterStateSnapshot
      ) as boolean | Promise<boolean>
    );
  }

  it('leaves an untouched form at once', async () => {
    await open();

    expect(await leave()).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('asks before leaving a changed form', async () => {
    await open();
    type(control(page(), `${REPOS}.RemoteSectionComponent.name`), 'handbook');
    await settle(fixture);

    expect(await leave()).toBe(false);
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({
      heading: `${REPOS}.AddRepositoryPage.discard.heading`,
      variant: 'danger'
    }));

    confirm.mockResolvedValue(true);
    expect(await leave()).toBe(true);
  });

  it('does not count a generated key as a change', async () => {
    await open();
    // The URL is filled in, not typed, so that only the key counts.
    fixture.componentInstance['model'].remoteUrl().value.set('git@github.com:acme/handbook.git');
    await settle(fixture);
    choose(page(), `${REPOS}.SshCredentialsComponent.choices.generate`);
    await settle(fixture);
    type(control(page(), `${REPOS}.GeneratedKeyComponent.name`), 'Front Burner');
    await settle(fixture);
    button(page(), `${REPOS}.GeneratedKeyComponent.generate`)?.click();
    await settle(fixture);
    page().querySelector<HTMLInputElement>('input[type=checkbox]')?.click();
    await settle(fixture);

    expect(await leave()).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('asks on reload or closing the tab while changed', async () => {
    await open();
    const untouched = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(untouched);
    expect(untouched.defaultPrevented).toBe(false);

    type(control(page(), `${REPOS}.RemoteSectionComponent.name`), 'handbook');
    await settle(fixture);
    const changed = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(changed);

    expect(changed.defaultPrevented).toBe(true);
  });
});
