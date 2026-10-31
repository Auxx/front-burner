import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { RepositorySummary } from '@front-burner/shared-contracts';

import { settle } from '../../../testing/settle';
import { translocoTesting } from '../../../testing/transloco-testing';
import { RecentRepositoriesComponent } from './recent-repositories.component';

const KEY = 'web-feature-dashboard.RecentRepositoriesComponent';

const repository = (id: number, name: string): RepositorySummary => ({
  id,
  name,
  remote: `github.com/acme/${name}`,
  status: 'ready',
  error: null,
  warnings: [],
  lastAccessedAt: '2026-10-26T10:00:00.000Z'
});

describe('RecentRepositoriesComponent', () => {
  let fixture: ComponentFixture<RecentRepositoriesComponent>;

  const host = () => fixture.nativeElement as HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ RecentRepositoriesComponent, translocoTesting() ],
      providers: [ provideRouter([]) ]
    }).compileComponents();
    fixture = TestBed.createComponent(RecentRepositoriesComponent);
    fixture.componentRef.setInput('repositories', [ repository(2, 'notes'), repository(1, 'handbook') ]);
    await settle(fixture);
  });

  it('lists the repositories in the order given, under its heading', () => {
    expect(host().querySelector('h2')?.textContent?.trim()).toBe(`${KEY}.heading`);
    const entries = [ ...host().querySelectorAll('ul.tiles > li.tile dash-repository-entry') ];
    expect(entries.map(entry => entry.querySelector('.name')?.textContent?.trim())).toEqual([ 'notes', 'handbook' ]);
  });

  it('links All repositories to the repository management page', () => {
    const link = [ ...host().querySelectorAll('a') ].find(a => a.textContent?.trim() === `${KEY}.all`);
    expect(link?.getAttribute('href')).toBe('/repositories');
  });
});
