import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { SavedCredentials } from '@front-burner/shared-contracts';
import { CredentialsApi } from '@front-burner/web-api-client';

import { FormHostComponent, hostWith } from '../../../testing/form-host';
import { choose, control, type } from '../../../testing/form-testing';
import { settle } from '../../../testing/settle';
import { translocoTesting } from '../../../testing/transloco-testing';
import { CredentialsSectionComponent } from './credentials-section.component';

const KEY = 'web-feature-repositories.CredentialsSectionComponent';
const HTTPS = 'web-feature-repositories.HttpsCredentialsComponent';

const savedHttps: SavedCredentials = {
  https: [ { id: 7, name: 'GitHub', username: 'octocat', missing: false } ],
  sshKeys: []
};

describe('CredentialsSectionComponent', () => {
  let fixture: ComponentFixture<FormHostComponent>;

  const page = () => fixture.nativeElement as HTMLElement;
  const host = () => fixture.componentInstance;

  async function open(saved: SavedCredentials | null = { https: [], sshKeys: [] }): Promise<void> {
    hostWith(
      '<repo-credentials-section [protocol]="protocol()" [credentials]="model.credentials" [saved]="shown()" />',
      [ CredentialsSectionComponent ]
    );
    await TestBed.configureTestingModule({
      imports: [ FormHostComponent, translocoTesting() ],
      providers: [ { provide: CredentialsApi, useValue: {} } ]
    }).compileComponents();
    fixture = TestBed.createComponent(FormHostComponent);
    host().saved.set(saved);
    await settle(fixture);
  }

  async function enterUrl(url: string): Promise<void> {
    host().model.remoteUrl().value.set(url);
    await settle(fixture);
  }

  it('asks for the URL first', async () => {
    await open();

    expect(page().textContent).toContain(`${KEY}.enterUrlFirst`);
    expect(page().querySelector('repo-https-credentials')).toBeNull();
  });

  it('shows the HTTPS options for an HTTPS URL', async () => {
    await open();

    await enterUrl('https://github.com/acme/handbook.git');

    expect(page().textContent).not.toContain(`${KEY}.enterUrlFirst`);
    expect(page().querySelector('repo-https-credentials')).not.toBeNull();
  });

  it('waits for the saved credentials before offering a choice', async () => {
    await open(null);

    await enterUrl('https://github.com/acme/handbook.git');

    expect(page().querySelector('repo-https-credentials')).toBeNull();
    expect(page().querySelector('ui-spinner')).not.toBeNull();
  });

  it('clears the other protocol\'s choices', async () => {
    await open(savedHttps);
    await enterUrl('https://github.com/acme/handbook.git');
    choose(page(), `${HTTPS}.choices.new-https`);
    await settle(fixture);
    type(control(page(), `${HTTPS}.username`), 'ada');
    await settle(fixture);

    await enterUrl('git@github.com:acme/handbook.git');
    expect(host().model.credentials().value()).toEqual(
      expect.objectContaining({ choice: 'new-ssh-key', savedId: 0, username: '' })
    );
    await enterUrl('https://github.com/acme/handbook.git');

    expect(host().model.credentials().value()).toEqual(
      expect.objectContaining({ choice: 'saved', savedId: 7, username: '' })
    );
  });

  it('keeps the choices while the URL is edited within a protocol', async () => {
    await open();
    await enterUrl('https://github.com/acme/handbook.git');
    type(control(page(), `${HTTPS}.username`), 'ada');
    await settle(fixture);

    await enterUrl('https://');
    await enterUrl('https://github.com/acme/wiki.git');

    expect(host().model.credentials.username().value()).toBe('ada');
  });
});
