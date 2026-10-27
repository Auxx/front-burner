import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { SavedCredentials, SavedSshKey } from '@front-burner/shared-contracts';
import { CredentialsApi } from '@front-burner/web-api-client';
import { of, throwError } from 'rxjs';

import { FormHostComponent, hostWith } from '../../../testing/form-host';
import {
  control,
  errorOf,
  field,
  openSelect,
  radio,
  radioLabels,
  selectOptions,
  type
} from '../../../testing/form-testing';
import { settle } from '../../../testing/settle';
import { translocoTesting } from '../../../testing/transloco-testing';
import { CredentialsSectionComponent } from '../credentials-section/credentials-section.component';

const KEY = 'web-feature-repositories.SshCredentialsComponent';
const ERRORS = 'web-feature-repositories.errors';

const locked: SavedSshKey = {
  id: 3,
  name: 'Laptop',
  keyType: 'ed25519',
  fingerprint: 'SHA256:lockedfingerprint',
  passphraseProtected: true,
  unlocked: false,
  generated: false,
  missing: false
};

const deployKey: SavedSshKey = {
  ...locked,
  id: 4,
  name: 'Deploy key',
  keyType: 'rsa',
  fingerprint: 'SHA256:deployfingerprint',
  passphraseProtected: false
};

describe('SshCredentialsComponent', () => {
  let fixture: ComponentFixture<FormHostComponent>;
  let api: { unlockSshKey: ReturnType<typeof vi.fn>; generateSshKey: ReturnType<typeof vi.fn>; };

  const page = () => fixture.nativeElement as HTMLElement;
  const host = () => fixture.componentInstance;

  /** The section as the page shows it, for an SSH URL. */
  async function open(sshKeys: SavedSshKey[] = []): Promise<void> {
    hostWith(
      '<repo-credentials-section [protocol]="protocol()" [credentials]="model.credentials" [saved]="shown()" />',
      [ CredentialsSectionComponent ]
    );
    await TestBed.configureTestingModule({
      imports: [ FormHostComponent, translocoTesting() ],
      providers: [ { provide: CredentialsApi, useValue: api } ]
    }).compileComponents();
    fixture = TestBed.createComponent(FormHostComponent);
    host().saved.set({ https: [], sshKeys } satisfies SavedCredentials);
    host().model.remoteUrl().value.set('git@github.com:acme/handbook.git');
    await settle(fixture);
  }

  beforeEach(() => {
    api = { unlockSshKey: vi.fn(() => of(undefined)), generateSshKey: vi.fn() };
  });

  afterEach(() => document.querySelector('.cdk-overlay-container')?.replaceChildren());

  it('offers paste and generate without saved keys', async () => {
    await open();

    expect(radioLabels(page())).toEqual([ `${KEY}.choices.new-ssh-key`, `${KEY}.choices.generate` ]);
    expect(radio(page(), `${KEY}.choices.new-ssh-key`)?.checked).toBe(true);
    expect(control(page(), `${KEY}.name`)).toBeTruthy();
    expect(control(page(), `${KEY}.privateKey`).tagName).toBe('TEXTAREA');
    expect((control(page(), `${KEY}.pastePassphrase`) as HTMLInputElement).type).toBe('password');
  });

  it('checks a pasted key\'s fields, with the passphrase optional', async () => {
    await open();

    for (const label of [ 'name', 'privateKey', 'pastePassphrase' ]) {
      control(page(), `${KEY}.${label}`).dispatchEvent(new Event('blur'));
    }
    await settle(fixture);

    expect(errorOf(page(), `${KEY}.name`)).toBe(`${ERRORS}.credentials.name.too-small`);
    expect(errorOf(page(), `${KEY}.privateKey`)).toBe(`${ERRORS}.credentials.privateKey.too-small`);
    expect(errorOf(page(), `${KEY}.pastePassphrase`)).toBeUndefined();
  });

  it('offers saved keys with protected ones marked', async () => {
    await open([ locked, deployKey ]);

    expect(radioLabels(page())).toEqual([
      `${KEY}.choices.saved`,
      `${KEY}.choices.new-ssh-key`,
      `${KEY}.choices.generate`
    ]);
    expect(radio(page(), `${KEY}.choices.saved`)?.checked).toBe(true);

    openSelect(page(), `${KEY}.saved`);
    await settle(fixture);
    const options = selectOptions();
    expect(options).toHaveLength(2);
    expect(options[0].textContent).toContain('Laptop');
    expect(options[0].textContent).toContain('ed25519 SHA256:lockedfingerprint');
    expect(options[0].textContent).toContain(`${KEY}.passphraseProtected`);
    expect(options[0].querySelector('ui-icon')).not.toBeNull();
    expect(options[1].textContent).toContain('rsa SHA256:deployfingerprint');
    expect(options[1].textContent).not.toContain(`${KEY}.passphraseProtected`);
  });

  it('asks for the passphrase of a locked key', async () => {
    await open([ locked ]);

    const passphrase = control(page(), `${KEY}.passphrase`) as HTMLInputElement;
    expect(passphrase.type).toBe('password');
    passphrase.dispatchEvent(new Event('blur'));
    await settle(fixture);
    expect(errorOf(page(), `${KEY}.passphrase`)).toBe(`${ERRORS}.credentials.passphrase.required`);
    expect(host().model.credentials().invalid()).toBe(true);
  });

  it('unlocks the key for the session once the passphrase is given', async () => {
    await open([ locked ]);

    type(control(page(), `${KEY}.passphrase`), 'correct horse');
    await settle(fixture);

    expect(api.unlockSshKey).toHaveBeenCalledWith(3, { passphrase: 'correct horse' });
    expect(page().textContent).toContain(`${KEY}.unlocked`);
    expect(() => field(page(), `${KEY}.passphrase`)).toThrow();
    expect(host().model.credentials.passphrase().value()).toBe('');
    expect(host().model.credentials().invalid()).toBe(false);
  });

  it('reports a wrong passphrase on its field', async () => {
    api.unlockSshKey.mockReturnValue(throwError(() =>
      new HttpErrorResponse({
        status: 422,
        error: {
          code: 'validation-failed',
          params: {},
          requestId: 'r',
          message: 'm',
          fields: [ { path: 'passphrase', code: 'wrong-passphrase', params: {} } ]
        }
      })
    ));
    await open([ locked ]);

    type(control(page(), `${KEY}.passphrase`), 'wrong');
    await settle(fixture);

    expect(errorOf(page(), `${KEY}.passphrase`)).toBe(`${ERRORS}.credentials.passphrase.wrong-passphrase`);
    expect(page().textContent).not.toContain(`${KEY}.unlocked`);
  });

  it('says a key is unlocked for this session', async () => {
    await open([ { ...locked, unlocked: true } ]);

    expect(page().textContent).toContain(`${KEY}.unlocked`);
    expect(() => field(page(), `${KEY}.passphrase`)).toThrow();
    expect(host().model.credentials().invalid()).toBe(false);
  });
});
