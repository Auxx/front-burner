import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { RepositoryIndex } from '@front-burner/shared-contracts';
import { CredentialsApi } from '@front-burner/web-api-client';

import { FormHostComponent, hostWith } from '../../../testing/form-host';
import { control, errorOf, type } from '../../../testing/form-testing';
import { settle } from '../../../testing/settle';
import { translocoTesting } from '../../../testing/transloco-testing';
import { RemoteSectionComponent } from './remote-section.component';

const KEY = 'web-feature-repositories.RemoteSectionComponent';
const ERRORS = 'web-feature-repositories.errors';

describe('RemoteSectionComponent', () => {
  let fixture: ComponentFixture<FormHostComponent>;

  const page = () => fixture.nativeElement as HTMLElement;
  const url = () => control(page(), `${KEY}.remoteUrl`);
  const name = () => control(page(), `${KEY}.name`);

  async function open(index: RepositoryIndex['repositories'] = []): Promise<void> {
    hostWith(
      '<repo-remote-section [remoteUrl]="model.remoteUrl" [name]="model.name" [index]="index()" />',
      [ RemoteSectionComponent ]
    );
    await TestBed.configureTestingModule({
      providers: [ { provide: CredentialsApi, useValue: {} } ],
      imports: [
        FormHostComponent,
        translocoTesting({
          [`${KEY}.duplicate`]: 'You already have this remote as {{ names }}.',
          [`${ERRORS}.name.name-taken`]: 'You already have a repository named {{ name }}'
        })
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(FormHostComponent);
    fixture.componentInstance.index.set(index);
    await settle(fixture);
  }

  async function enterUrl(text: string): Promise<void> {
    type(url(), text);
    await settle(fixture);
  }

  it.each([
    'http://github.com/acme/handbook.git',
    'git://github.com/acme/handbook.git',
    'file:///srv/git/handbook.git',
    '/srv/git/handbook.git'
  ])('rejects %s with "Use an HTTPS or SSH URL"', async text => {
    await open();

    await enterUrl(text);

    expect(errorOf(page(), `${KEY}.remoteUrl`)).toBe(`${ERRORS}.remoteUrl.unsupported`);
  });

  it('rejects a URL with credentials', async () => {
    await open();

    await enterUrl('https://ada:secret@github.com/acme/handbook.git');

    expect(errorOf(page(), `${KEY}.remoteUrl`)).toBe(`${ERRORS}.remoteUrl.credentials-in-url`);
  });

  it('shows no error before the field is left', async () => {
    await open();

    url().value = 'http://example.com/a';
    url().dispatchEvent(new Event('input'));
    await settle(fixture);

    expect(errorOf(page(), `${KEY}.remoteUrl`)).toBeUndefined();
  });

  it('fills the name from the URL', async () => {
    await open();

    await enterUrl('https://github.com/acme/handbook.git');

    expect(name().value).toBe('handbook');
    expect(errorOf(page(), `${KEY}.remoteUrl`)).toBeUndefined();
  });

  it('stops filling the name once edited', async () => {
    await open();
    await enterUrl('https://github.com/acme/handbook.git');

    type(name(), 'Team handbook');
    await settle(fixture);
    await enterUrl('git@github.com:acme/wiki.git');

    expect(name().value).toBe('Team handbook');
  });

  it('warns about a remote the user already has', async () => {
    await open([
      { name: 'Handbook', remoteKey: 'github.com/acme/handbook' },
      { name: 'Old handbook', remoteKey: 'github.com/acme/handbook' },
      { name: 'Wiki', remoteKey: 'github.com/acme/wiki' }
    ]);

    await enterUrl('git@github.com:acme/handbook.git');

    expect(page().querySelector('.duplicate')?.textContent?.trim()).toBe(
      'You already have this remote as Handbook, Old handbook.'
    );
  });

  it('does not warn about a new remote', async () => {
    await open([ { name: 'Wiki', remoteKey: 'github.com/acme/wiki' } ]);

    await enterUrl('https://github.com/acme/handbook.git');

    expect(page().querySelector('.duplicate')).toBeNull();
  });

  it('rejects a taken name in any case', async () => {
    await open([ { name: 'Handbook', remoteKey: 'github.com/acme/handbook' } ]);

    type(name(), ' HANDBOOK ');
    await settle(fixture);

    expect(errorOf(page(), `${KEY}.name`)).toBe('You already have a repository named HANDBOOK');
  });

  it('rejects an empty name', async () => {
    await open();

    type(name(), '  ');
    await settle(fixture);

    expect(errorOf(page(), `${KEY}.name`)).toBe(`${ERRORS}.name.too-small`);
  });
});
