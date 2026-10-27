import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type {
  AccessCheckRequest,
  AccessCheckResult,
  CurrentUser,
  GitLevel,
  RepositoryIndex
} from '@front-burner/shared-contracts';
import { CredentialsApi, RepositoriesApi } from '@front-burner/web-api-client';
import { CurrentUserService } from '@front-burner/web-core';
import { of, Subject } from 'rxjs';

import { choose, control, field, selectValue, type } from '../../../testing/form-testing';
import { settle } from '../../../testing/settle';
import { translocoTesting } from '../../../testing/transloco-testing';
import { AddRepositoryPage } from './add-repository.page';

const KEY = 'web-feature-repositories.AddRepositoryPage';
const REPOS = 'web-feature-repositories';

function userWith(allowedGitLevels: GitLevel[]): CurrentUser {
  return { id: 4, email: 'ada@example.com', displayName: 'Ada', role: 'user', allowedGitLevels };
}

describe('AddRepositoryPage', () => {
  let fixture: ComponentFixture<AddRepositoryPage>;
  let accessChecks: { request: AccessCheckRequest; answer: Subject<AccessCheckResult>; }[];

  const page = () => fixture.nativeElement as HTMLElement;

  async function open(
    options: { index?: RepositoryIndex; allowedGitLevels?: GitLevel[]; } = {}
  ): Promise<void> {
    accessChecks = [];
    const repositoriesApi = {
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
        { provide: CurrentUserService, useValue: { load: () => Promise.resolve(user) } }
      ]
    }).compileComponents();
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
});
