import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { RepositoryIndex } from '@front-burner/shared-contracts';
import { RepositoriesApi } from '@front-burner/web-api-client';
import { of } from 'rxjs';

import { settle } from '../../../testing/settle';
import { translocoTesting } from '../../../testing/transloco-testing';
import { AddRepositoryPage } from './add-repository.page';

const KEY = 'web-feature-repositories.AddRepositoryPage';

describe('AddRepositoryPage', () => {
  let fixture: ComponentFixture<AddRepositoryPage>;

  const page = () => fixture.nativeElement as HTMLElement;

  async function open(index: RepositoryIndex = { repositories: [] }): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [ AddRepositoryPage, translocoTesting() ],
      providers: [
        provideRouter([]),
        { provide: RepositoriesApi, useValue: { index: () => of(index) } }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(AddRepositoryPage);
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

  it('starts with the remote section', async () => {
    await open();

    expect(page().querySelector('form repo-remote-section')).not.toBeNull();
  });
});
