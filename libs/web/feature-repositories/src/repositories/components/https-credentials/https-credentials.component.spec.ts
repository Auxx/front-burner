import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { SavedCredentials } from '@front-burner/shared-contracts';

import { FormHostComponent, hostWith } from '../../../testing/form-host';
import { choose, control, errorOf, field, radio, radioLabels } from '../../../testing/form-testing';
import { settle } from '../../../testing/settle';
import { translocoTesting } from '../../../testing/transloco-testing';
import { CredentialsSectionComponent } from '../credentials-section/credentials-section.component';

const KEY = 'web-feature-repositories.HttpsCredentialsComponent';
const ERRORS = 'web-feature-repositories.errors';

const saved: SavedCredentials = {
  https: [
    { id: 7, name: 'GitHub', username: 'octocat', missing: false },
    { id: 8, name: 'Bitbucket', username: 'ada', missing: false }
  ],
  sshKeys: []
};

describe('HttpsCredentialsComponent', () => {
  let fixture: ComponentFixture<FormHostComponent>;

  const page = () => fixture.nativeElement as HTMLElement;
  const host = () => fixture.componentInstance;

  /** The section as the page shows it, for an HTTPS URL. */
  async function open(credentials: SavedCredentials = { https: [], sshKeys: [] }): Promise<void> {
    hostWith(
      '<repo-credentials-section [protocol]="protocol()" [credentials]="model.credentials" [saved]="saved()" />',
      [ CredentialsSectionComponent ]
    );
    await TestBed.configureTestingModule({ imports: [ FormHostComponent, translocoTesting() ] }).compileComponents();
    fixture = TestBed.createComponent(FormHostComponent);
    host().saved.set(credentials);
    host().model.remoteUrl().value.set('https://github.com/acme/handbook.git');
    await settle(fixture);
  }

  it('offers new and no credentials without saved ones', async () => {
    await open();

    expect(radioLabels(page())).toEqual([ `${KEY}.choices.new-https`, `${KEY}.choices.none` ]);
    expect(radio(page(), `${KEY}.choices.new-https`)?.checked).toBe(true);
    expect(control(page(), `${KEY}.name`)).toBeTruthy();
    expect(control(page(), `${KEY}.username`).getAttribute('autocomplete')).toBe('off');
    expect(control(page(), `${KEY}.password`).type).toBe('password');
    expect(field(page(), `${KEY}.password`).querySelector('.hint')?.textContent?.trim()).toBe(`${KEY}.passwordHint`);
  });

  it('preselects saved credentials when there are some', async () => {
    await open(saved);

    expect(radioLabels(page())).toEqual([
      `${KEY}.choices.saved`,
      `${KEY}.choices.new-https`,
      `${KEY}.choices.none`
    ]);
    expect(radio(page(), `${KEY}.choices.saved`)?.checked).toBe(true);
    expect(field(page(), `${KEY}.saved`).querySelector('.value')?.textContent?.trim()).toBe('GitHub (octocat)');
    expect(host().model.credentials.savedId().value()).toBe(7);
  });

  it('checks the new credentials\' fields', async () => {
    await open();

    for (const label of [ 'name', 'username', 'password' ]) {
      control(page(), `${KEY}.${label}`).dispatchEvent(new Event('blur'));
    }
    await settle(fixture);

    expect(errorOf(page(), `${KEY}.name`)).toBe(`${ERRORS}.credentials.name.too-small`);
    expect(errorOf(page(), `${KEY}.username`)).toBe(`${ERRORS}.credentials.username.too-small`);
    expect(errorOf(page(), `${KEY}.password`)).toBe(`${ERRORS}.credentials.password.too-small`);
    expect(host().model.credentials().invalid()).toBe(true);
  });

  it('needs no fields for a public repository, and says what it means', async () => {
    await open();

    choose(page(), `${KEY}.choices.none`);
    await settle(fixture);

    expect(page().querySelectorAll('ui-field')).toHaveLength(0);
    expect(page().textContent).toContain(`${KEY}.noneHint`);
    expect(host().model.credentials().invalid()).toBe(false);
  });
});
