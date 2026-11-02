import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { submit } from '@angular/forms/signals';
import type { FieldError } from '@front-burner/shared-contracts';

import { settle } from '../../../testing/settle';
import { translocoTesting } from '../../../testing/transloco-testing';
import { commitAuthorForm } from '../../models/commit-author-form.model';
import { CommitAuthorFormComponent } from './commit-author-form.component';

const KEY = 'web-repository-dialogs.CommitAuthorFormComponent';
const LABELS = 'web-repository-dialogs.commitAuthor';
const ERRORS = 'web-repository-dialogs.errors';

@Component({
  imports: [ CommitAuthorFormComponent ],
  template: '<dlg-commit-author-form [field]="model" [serverErrors]="serverErrors()" />',
  changeDetection: ChangeDetectionStrategy.OnPush
})
class HostComponent {
  readonly model = commitAuthorForm({ name: 'Ada', email: 'ada@example.com' });
  readonly serverErrors = signal<FieldError[]>([]);
}

describe('CommitAuthorFormComponent', () => {
  let fixture: ComponentFixture<HostComponent>;

  const page = () => fixture.nativeElement as HTMLElement;
  const field = (label: string) => {
    const found = [ ...page().querySelectorAll<HTMLElement>('ui-field') ].find(
      element => element.querySelector('.label')?.textContent?.trim() === `${LABELS}.${label}`
    );
    if (!found) {
      throw new Error(`No field labelled ${label}`);
    }
    return found;
  };
  const errorOf = (label: string) => field(label).querySelector('.error')?.textContent?.trim();

  async function enter(label: string, text: string): Promise<void> {
    const input = field(label).querySelector('input') as HTMLInputElement;
    input.value = text;
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('blur'));
    await settle(fixture);
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ HostComponent, translocoTesting() ] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    await settle(fixture);
  });

  it('shows the values it is given', () => {
    expect((field('name').querySelector('input') as HTMLInputElement).value).toBe('Ada');
    expect((field('email').querySelector('input') as HTMLInputElement).value).toBe('ada@example.com');
  });

  it('AC-GIT-001.7: shows the reason next to the field for a name with <, an email without @ and an email with a space', async () => {
    await enter('name', 'Ada <Lovelace');
    expect(errorOf('name')).toBe(`${ERRORS}.name.name-invalid`);

    await enter('email', 'ada.example.com');
    expect(errorOf('email')).toBe(`${ERRORS}.email.email-invalid`);

    await enter('email', 'ada lovelace@example.com');
    expect(errorOf('email')).toBe(`${ERRORS}.email.email-invalid`);
    expect(fixture.componentInstance.model().invalid()).toBe(true);
  });

  it.each([ '12345+user@users.noreply.github.com', 'me@nas' ])('AC-GIT-001.7: accepts the email %s', async email => {
    await enter('email', email);

    expect(errorOf('email')).toBeUndefined();
    expect(fixture.componentInstance.model().valid()).toBe(true);
  });

  it('shows the reason for an empty field only once the field is touched', async () => {
    expect(errorOf('name')).toBeUndefined();

    await enter('name', '   ');

    expect(errorOf('name')).toBe(`${ERRORS}.name.name-required`);
  });

  it('shows the backend\'s field errors next to the fields', async () => {
    fixture.componentInstance.serverErrors.set([
      { path: 'name', code: 'name-too-long', params: {} },
      { path: 'email', code: 'email-invalid', params: {} }
    ]);
    await settle(fixture);

    expect(errorOf('name')).toBe(`${ERRORS}.name.name-too-long`);
    expect(errorOf('email')).toBe(`${ERRORS}.email.email-invalid`);
  });

  it('shows a general reason for a field error code it has no text for', async () => {
    fixture.componentInstance.serverErrors.set([ { path: 'name', code: 'newer-than-this-client', params: {} } ]);
    await settle(fixture);

    expect(errorOf('name')).toBe(`${ERRORS}.invalid`);
  });

  it('makes the fields read-only while the form is being submitted', async () => {
    const input = (label: string) => field(label).querySelector('input') as HTMLInputElement;
    let finish!: () => void;
    const done = submit(fixture.componentInstance.model, () =>
      new Promise<undefined>(resolve => {
        finish = () => resolve(undefined);
      }));
    await settle(fixture);

    expect(input('name').readOnly).toBe(true);
    expect(input('email').readOnly).toBe(true);

    finish();
    await done;
    await settle(fixture);

    expect(input('name').readOnly).toBe(false);
    expect(input('email').readOnly).toBe(false);
  });

  it('explains the email, and only the email', () => {
    expect(field('email').querySelector('.hint')?.textContent?.trim()).toBe(`${KEY}.emailHint`);
    expect(field('name').querySelector('.hint')).toBeNull();
  });

  it('links the hint to the providers\' help', () => {
    const links = [ ...page().querySelectorAll('a') ];

    expect(links.map(link => [ link.textContent?.trim(), link.getAttribute('href') ])).toEqual([
      [ `${KEY}.githubHelp`, 'https://docs.github.com/en/account-and-profile/reference/email-addresses-reference' ],
      [
        `${KEY}.bitbucketHelp`,
        'https://support.atlassian.com/bitbucket-cloud/docs/configure-your-dvcs-username-for-commits/'
      ]
    ]);
    for (const link of links) {
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    }
  });
});
