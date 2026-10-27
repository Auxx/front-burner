import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DefaultUrlSerializer, provideRouter, Router, type UrlTree } from '@angular/router';
import type {
  AccessCheckRequest,
  AccessCheckResult,
  AddRepositoryRequest,
  ApiError,
  CurrentUser,
  GitLevel,
  HostKey,
  RepositoryIndex,
  RepositorySummary
} from '@front-burner/shared-contracts';
import { DialogService } from '@front-burner/ui';
import { CredentialsApi, KnownHostsApi, RepositoriesApi } from '@front-burner/web-api-client';
import { CurrentUserService } from '@front-burner/web-core';
import { Observable, of, Subject, throwError } from 'rxjs';

import { button, choose, control, errorOf, field, selectValue, type } from '../../../testing/form-testing';
import { settle } from '../../../testing/settle';
import { translocoTesting } from '../../../testing/transloco-testing';
import { TrustHostDialog } from '../../dialogs/trust-host/trust-host.dialog';
import { AddRepositoryPage } from './add-repository.page';

const KEY = 'web-feature-repositories.AddRepositoryPage';
const REPOS = 'web-feature-repositories';

function userWith(allowedGitLevels: GitLevel[]): CurrentUser {
  return { id: 4, email: 'ada@example.com', displayName: 'Ada', role: 'user', allowedGitLevels };
}

const added: RepositorySummary = {
  id: 12,
  name: 'handbook',
  remote: 'github.com/acme/handbook',
  status: 'cloning',
  error: null,
  warnings: [],
  lastAccessedAt: '2026-10-27T10:00:00.000Z'
};

const hostKey: HostKey = {
  host: 'git.example.com',
  port: 22,
  type: 'ssh-ed25519',
  key: 'AAAAC3NzaC1lZDI1NTE5AAAAIH',
  fingerprint: 'SHA256:examplefingerprint'
};

function failure(status: number, error: Partial<ApiError>): HttpErrorResponse {
  return new HttpErrorResponse({ status, error: { params: {}, requestId: 'abcdef123456', message: 'm', ...error } });
}

describe('AddRepositoryPage', () => {
  let fixture: ComponentFixture<AddRepositoryPage>;
  let accessChecks: { request: AccessCheckRequest; answer: Subject<AccessCheckResult>; }[];
  let adds: AddRepositoryRequest[];
  let addAnswers: (() => Observable<RepositorySummary>)[];
  let dialogs: { open: ReturnType<typeof vi.fn>; confirm: ReturnType<typeof vi.fn>; };
  let knownHosts: { trust: ReturnType<typeof vi.fn>; };

  const page = () => fixture.nativeElement as HTMLElement;

  async function open(
    options: { index?: RepositoryIndex; allowedGitLevels?: GitLevel[]; cameFrom?: UrlTree; } = {}
  ): Promise<void> {
    accessChecks = [];
    adds = [];
    addAnswers = [];
    dialogs = { open: vi.fn(() => ({ closed: of(true) })), confirm: vi.fn(() => Promise.resolve(true)) };
    knownHosts = { trust: vi.fn(() => of(undefined)) };
    const repositoriesApi = {
      add: (request: AddRepositoryRequest) => {
        adds.push(structuredClone(request));
        return (addAnswers.shift() ?? (() => of(added)))();
      },
      index: () => of(options.index ?? { repositories: [] }),
      accessCheck: (request: AccessCheckRequest) => {
        const answer = new Subject<AccessCheckResult>();
        accessChecks.push({ request, answer });
        return answer;
      }
    };
    const user = userWith(options.allowedGitLevels ?? [ 'simple', 'guided', 'advanced' ]);
    await TestBed.configureTestingModule({
      imports: [ AddRepositoryPage, translocoTesting() ],
      providers: [
        provideRouter([]),
        { provide: RepositoriesApi, useValue: repositoriesApi },
        { provide: CredentialsApi, useValue: { list: () => of({ https: [], sshKeys: [] }) } },
        { provide: CurrentUserService, useValue: { load: () => Promise.resolve(user) } },
        { provide: KnownHostsApi, useValue: knownHosts },
        { provide: DialogService, useValue: dialogs }
      ]
    }).compileComponents();
    if (options.cameFrom) {
      // As after a navigation inside the web client.
      const finalUrl = options.cameFrom;
      Object.defineProperty(TestBed.inject(Router), 'lastSuccessfulNavigation', {
        get: () => () => ({ finalUrl }),
        configurable: true
      });
    }
    fixture = TestBed.createComponent(AddRepositoryPage);
    await settle(fixture);
  }

  async function enterUrl(url: string): Promise<void> {
    type(control(page(), `${REPOS}.RemoteSectionComponent.remoteUrl`), url);
    await settle(fixture);
  }

  it('has one h1, "Add repository", that takes the focus after navigation', async () => {
    await open();

    expect(page().querySelectorAll('h1')).toHaveLength(1);
    expect(page().querySelector('h1')?.textContent?.trim()).toBe(`${KEY}.heading`);
    expect(page().querySelector('h1')?.getAttribute('tabindex')).toBe('-1');
  });

  it('shows the breadcrumbs', async () => {
    await open();

    const breadcrumbs = page().querySelector('ui-breadcrumbs');
    expect(breadcrumbs?.getAttribute('aria-label')).toBe(`${KEY}.breadcrumbs`);
    const items = [ ...(breadcrumbs?.querySelectorAll('li') ?? []) ];
    expect(items.map(item => item.textContent?.trim())).toEqual([ `${KEY}.repositories`, `${KEY}.heading` ]);
    expect(items[0].querySelector('a')?.getAttribute('href')).toBe('/repositories');
    expect(items[1].querySelector('a')).toBeNull();
    expect(items[1].getAttribute('aria-current')).toBe('page');
  });

  it('has the sections in the order of AR-5', async () => {
    await open();

    const sections = [ ...page().querySelectorAll('form > *') ].map(element => element.tagName.toLowerCase());
    expect(sections.slice(0, 4)).toEqual([
      'repo-remote-section',
      'repo-credentials-section',
      'repo-clone-section',
      'repo-level-section'
    ]);
  });

  it('defaults to the highest allowed level', async () => {
    await open({ allowedGitLevels: [ 'simple', 'guided' ] });

    expect(selectValue(page(), `${REPOS}.LevelSectionComponent.label`)).toBe(
      `${REPOS}.LevelSectionComponent.levels.guided`
    );
  });

  it('hides the level with one allowed level', async () => {
    await open({ allowedGitLevels: [ 'simple' ] });

    expect(() => field(page(), `${REPOS}.LevelSectionComponent.label`)).toThrow();
  });

  it('loads the branches when single branch is chosen', async () => {
    await open();
    await enterUrl('https://github.com/acme/handbook.git');
    choose(page(), `${REPOS}.HttpsCredentialsComponent.choices.none`);
    await settle(fixture);
    expect(accessChecks).toHaveLength(0);

    choose(page(), `${REPOS}.CloneSectionComponent.modes.single-branch`);
    await vi.waitFor(() => expect(accessChecks).toHaveLength(1), { timeout: 2000 });
    expect(accessChecks[0].request).toEqual({
      remoteUrl: 'https://github.com/acme/handbook.git',
      credentials: { mode: 'none' }
    });
    accessChecks[0].answer.next({ branches: [ 'feature/x', 'main' ], defaultBranch: 'main' });
    await settle(fixture);

    expect(selectValue(page(), `${REPOS}.CloneSectionComponent.branch`)).toBe('main');
    expect(page().textContent).toContain(`${REPOS}.CloneSectionComponent.warning`);
    expect(page().textContent).toContain(`${REPOS}.CloneSectionComponent.understood`);
  });

  it('checks the branches again when the URL changes', async () => {
    await open();
    await enterUrl('https://github.com/acme/handbook.git');
    choose(page(), `${REPOS}.HttpsCredentialsComponent.choices.none`);
    choose(page(), `${REPOS}.CloneSectionComponent.modes.single-branch`);
    await vi.waitFor(() => expect(accessChecks).toHaveLength(1), { timeout: 2000 });

    await enterUrl('https://github.com/acme/wiki.git');

    await vi.waitFor(() => expect(accessChecks).toHaveLength(2), { timeout: 2000 });
    expect(accessChecks[1].request.remoteUrl).toBe('https://github.com/acme/wiki.git');
  });

  it('does not check the branches for a full clone', async () => {
    await open();
    await enterUrl('https://github.com/acme/handbook.git');
    choose(page(), `${REPOS}.HttpsCredentialsComponent.choices.none`);
    await new Promise(resolve => setTimeout(resolve, 700));

    expect(accessChecks).toHaveLength(0);
  });

  describe('submitting', () => {
    const submit = () => button(page(), `${KEY}.submit`);
    const cancel = () => button(page(), `${KEY}.cancel`);
    const url = () => control(page(), `${REPOS}.RemoteSectionComponent.remoteUrl`);

    /** A public HTTPS repository: valid as soon as the URL is in. */
    async function fillPublic(): Promise<void> {
      await enterUrl('https://github.com/acme/handbook.git');
      choose(page(), `${REPOS}.HttpsCredentialsComponent.choices.none`);
      await settle(fixture);
    }

    /** A pasted, encrypted SSH key. */
    async function fillPastedKey(): Promise<void> {
      await enterUrl('git@git.example.com:acme/handbook.git');
      type(control(page(), `${REPOS}.SshCredentialsComponent.name`), 'Laptop');
      type(control(page(), `${REPOS}.SshCredentialsComponent.privateKey`), '-----BEGIN OPENSSH PRIVATE KEY-----');
      type(control(page(), `${REPOS}.SshCredentialsComponent.pastePassphrase`), 'correct horse');
      await settle(fixture);
    }

    async function clickSubmit(): Promise<void> {
      submit()?.click();
      await settle(fixture);
    }

    it('keeps Add repository unavailable while the form is empty', async () => {
      await open();

      expect(submit()?.getAttribute('aria-disabled')).toBe('true');
      await clickSubmit();
      expect(adds).toHaveLength(0);
    });

    it('sends the form', async () => {
      await open({ allowedGitLevels: [ 'simple', 'guided' ] });
      await fillPublic();

      expect(submit()?.getAttribute('aria-disabled')).toBeNull();
      await clickSubmit();

      expect(adds).toEqual([ {
        remoteUrl: 'https://github.com/acme/handbook.git',
        name: 'handbook',
        credentials: { mode: 'none' },
        cloneMode: 'full',
        gitLevel: 'guided'
      } ]);
    });

    it('disables Add repository while a submit runs and makes the form read-only', async () => {
      await open();
      await fillPublic();
      const answer = new Subject<RepositorySummary>();
      addAnswers.push(() => answer);

      await clickSubmit();

      expect(submit()?.getAttribute('aria-disabled')).toBe('true');
      expect(url().disabled).toBe(true);
      await clickSubmit();
      expect(adds).toHaveLength(1);
      answer.error(failure(504, { code: 'remote-timeout', params: { host: 'github.com' } }));
      await settle(fixture);
      expect(url().disabled).toBe(false);
    });

    it('goes to the dashboard after adding', async () => {
      await open();
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
      await fillPublic();

      await clickSubmit();

      expect(navigate).toHaveBeenCalledWith('/', { state: { addedRepository: 'handbook' } });
    });

    it('keeps the form but not the passphrases after a failure', async () => {
      await open();
      await fillPastedKey();
      addAnswers.push(() =>
        throwError(() =>
          failure(422, {
            code: 'validation-failed',
            fields: [ { path: 'credentials.privateKey', code: 'invalid-key', params: {} } ]
          })
        )
      );

      await clickSubmit();

      expect(adds[0].credentials).toEqual(
        expect.objectContaining({ mode: 'new-ssh-key', passphrase: 'correct horse' })
      );
      expect(url().value).toBe('git@git.example.com:acme/handbook.git');
      expect(control(page(), `${REPOS}.SshCredentialsComponent.privateKey`).value).toBe(
        '-----BEGIN OPENSSH PRIVATE KEY-----'
      );
      expect(control(page(), `${REPOS}.SshCredentialsComponent.pastePassphrase`).value).toBe('');
      expect(errorOf(page(), `${REPOS}.SshCredentialsComponent.privateKey`)).toBe(
        `${REPOS}.errors.credentials.privateKey.invalid-key`
      );
      expect(url().disabled).toBe(false);
    });

    it('shows a failure of no single field above the buttons', async () => {
      await open();
      await fillPublic();
      addAnswers.push(() => throwError(() => failure(504, { code: 'remote-timeout', params: { host: 'github.com' } })));

      await clickSubmit();

      const banner = page().querySelector('.failure');
      expect(banner?.textContent).toContain(`${REPOS}.errors.form.remote-timeout`);
      expect(banner?.compareDocumentPosition(submit() as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    });

    it('shows refused credentials on the credentials section', async () => {
      await open();
      await fillPublic();
      addAnswers.push(() =>
        throwError(() =>
          failure(422, {
            code: 'validation-failed',
            fields: [ { path: 'credentials', code: 'credentials-required', params: {} } ]
          })
        )
      );

      await clickSubmit();

      expect(page().querySelector('repo-credentials-section .error')?.textContent?.trim()).toBe(
        `${REPOS}.errors.credentials.credentials-required`
      );
    });

    it('asks to trust an unknown host and repeats the request', async () => {
      await open();
      await fillPastedKey();
      addAnswers.push(() => throwError(() => failure(409, { code: 'host-key-unknown', params: hostKey })));
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);

      await clickSubmit();

      expect(dialogs.open).toHaveBeenCalledWith(TrustHostDialog, expect.objectContaining({ data: hostKey }));
      expect(knownHosts.trust).toHaveBeenCalledWith({
        host: 'git.example.com',
        port: 22,
        type: 'ssh-ed25519',
        key: 'AAAAC3NzaC1lZDI1NTE5AAAAIH'
      });
      expect(adds).toHaveLength(2);
      expect(adds[1]).toEqual(adds[0]);
      expect(navigate).toHaveBeenCalled();
    });

    it('leaves the form as it was on Cancel', async () => {
      await open();
      await fillPastedKey();
      addAnswers.push(() => throwError(() => failure(409, { code: 'host-key-unknown', params: hostKey })));
      dialogs.open.mockReturnValue({ closed: of(false) });

      await clickSubmit();

      expect(knownHosts.trust).not.toHaveBeenCalled();
      expect(adds).toHaveLength(1);
      expect(control(page(), `${REPOS}.SshCredentialsComponent.pastePassphrase`).value).toBe('correct horse');
      expect(page().querySelector('.failure')).toBeNull();
      expect(page().querySelectorAll('.error')).toHaveLength(0);
      expect(url().disabled).toBe(false);
    });

    it('asks to trust an unknown host found by the branch list, and checks again', async () => {
      await open();
      await enterUrl('git@git.example.com:acme/handbook.git');
      type(control(page(), `${REPOS}.SshCredentialsComponent.name`), 'Laptop');
      type(control(page(), `${REPOS}.SshCredentialsComponent.privateKey`), '-----BEGIN OPENSSH PRIVATE KEY-----');
      choose(page(), `${REPOS}.CloneSectionComponent.modes.single-branch`);
      await vi.waitFor(() => expect(accessChecks).toHaveLength(1), { timeout: 2000 });

      accessChecks[0].answer.error(failure(409, { code: 'host-key-unknown', params: hostKey }));
      await settle(fixture);

      expect(dialogs.open).toHaveBeenCalledWith(TrustHostDialog, expect.objectContaining({ data: hostKey }));
      await vi.waitFor(() => expect(accessChecks).toHaveLength(2));
      expect(knownHosts.trust).toHaveBeenCalled();
      expect(accessChecks[1].request).toEqual(accessChecks[0].request);
    });

    it('goes back to the previous page on Cancel', async () => {
      const previous = new DefaultUrlSerializer().parse('/repositories/7');
      await open({ cameFrom: previous });
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);

      cancel()?.click();
      await settle(fixture);

      expect(navigate).toHaveBeenCalledWith(previous);
    });

    it('goes to the dashboard on Cancel when there is no previous page', async () => {
      await open();
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);

      cancel()?.click();
      await settle(fixture);

      expect(navigate).toHaveBeenCalledWith('/');
    });
  });
});
