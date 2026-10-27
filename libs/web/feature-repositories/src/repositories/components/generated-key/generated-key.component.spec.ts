import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { GeneratedSshKey } from '@front-burner/shared-contracts';
import { ToastService } from '@front-burner/ui';
import { CredentialsApi } from '@front-burner/web-api-client';
import { of, throwError } from 'rxjs';

import { FormHostComponent, hostWith } from '../../../testing/form-host';
import { button, choose, control, errorOf, radio, radioLabels, type } from '../../../testing/form-testing';
import { settle } from '../../../testing/settle';
import { translocoTesting } from '../../../testing/transloco-testing';
import { CredentialsSectionComponent } from '../credentials-section/credentials-section.component';

const KEY = 'web-feature-repositories.GeneratedKeyComponent';
const SSH = 'web-feature-repositories.SshCredentialsComponent';
const ERRORS = 'web-feature-repositories.errors';

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
  publicKey: 'ssh-ed25519 AAAAC3Nza front-burner@example.com'
};

describe('GeneratedKeyComponent', () => {
  let fixture: ComponentFixture<FormHostComponent>;
  let api: { generateSshKey: ReturnType<typeof vi.fn>; unlockSshKey: ReturnType<typeof vi.fn>; };
  let writeText: ReturnType<typeof vi.fn>;
  let show: ReturnType<typeof vi.fn>;

  const page = () => fixture.nativeElement as HTMLElement;
  const host = () => fixture.componentInstance;

  /** The section for an SSH URL, with Generate a key chosen. */
  async function open(): Promise<void> {
    hostWith(
      '<repo-credentials-section [protocol]="protocol()" [credentials]="model.credentials" [saved]="shown()" />',
      [ CredentialsSectionComponent ]
    );
    await TestBed.configureTestingModule({
      imports: [ FormHostComponent, translocoTesting() ],
      providers: [ { provide: CredentialsApi, useValue: api }, { provide: ToastService, useValue: { show } } ]
    }).compileComponents();
    fixture = TestBed.createComponent(FormHostComponent);
    host().model.remoteUrl().value.set('git@github.com:acme/handbook.git');
    await settle(fixture);
    choose(page(), `${SSH}.choices.generate`);
    await settle(fixture);
  }

  async function generate(): Promise<void> {
    type(control(page(), `${KEY}.name`), 'Front Burner');
    await settle(fixture);
    button(page(), `${KEY}.generate`)?.click();
    await settle(fixture);
  }

  const publicKey = () => page().querySelector<HTMLTextAreaElement>('textarea[readonly]');

  beforeEach(() => {
    api = { generateSshKey: vi.fn(() => of(generated)), unlockSshKey: vi.fn() };
    writeText = vi.fn(() => Promise.resolve());
    show = vi.fn();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  });

  it('asks for a key name before generating', async () => {
    await open();

    button(page(), `${KEY}.generate`)?.click();
    await settle(fixture);

    expect(api.generateSshKey).not.toHaveBeenCalled();
    expect(errorOf(page(), `${KEY}.name`)).toBe(`${ERRORS}.credentials.generateName.too-small`);
  });

  it('generates a key once and shows its public key with Copy', async () => {
    await open();

    await generate();

    expect(api.generateSshKey).toHaveBeenCalledWith({ name: 'Front Burner' });
    expect(publicKey()?.value).toBe(generated.publicKey);
    expect(button(page(), `${KEY}.generate`)).toBeUndefined();
    expect(page().textContent).toContain(`${KEY}.instructions`);

    button(page(), `${KEY}.copy`)?.click();
    await settle(fixture);
    expect(writeText).toHaveBeenCalledWith(generated.publicKey);
    expect(show).toHaveBeenCalledWith(expect.objectContaining({ message: `${KEY}.copied` }));
  });

  it('reports a taken key name on its field', async () => {
    api.generateSshKey.mockReturnValue(throwError(() =>
      new HttpErrorResponse({
        status: 422,
        error: {
          code: 'validation-failed',
          params: {},
          requestId: 'r',
          message: 'm',
          fields: [ { path: 'name', code: 'name-taken', params: {} } ]
        }
      })
    ));
    await open();

    await generate();

    expect(errorOf(page(), `${KEY}.name`)).toBe(`${ERRORS}.credentials.generateName.name-taken`);
    expect(publicKey()).toBeNull();
  });

  it('requires the key-added checkbox', async () => {
    await open();
    await generate();

    expect(host().model.credentials().invalid()).toBe(true);
    const checkbox = page().querySelector<HTMLInputElement>('input[type=checkbox]');
    expect(checkbox?.closest('label')?.textContent?.trim()).toBe(`${KEY}.keyAdded`);
    checkbox?.click();
    await settle(fixture);

    expect(host().model.credentials().invalid()).toBe(false);
  });

  it('keeps the generated key when switching options', async () => {
    await open();
    await generate();

    choose(page(), `${SSH}.choices.new-ssh-key`);
    await settle(fixture);
    expect(radioLabels(page())).toContain(`${SSH}.choices.saved`);
    choose(page(), `${SSH}.choices.generate`);
    await settle(fixture);

    expect(publicKey()?.value).toBe(generated.publicKey);
    expect(button(page(), `${KEY}.generate`)).toBeUndefined();
    expect(api.generateSshKey).toHaveBeenCalledTimes(1);
    expect(radio(page(), `${SSH}.choices.generate`)?.checked).toBe(true);
  });
});
