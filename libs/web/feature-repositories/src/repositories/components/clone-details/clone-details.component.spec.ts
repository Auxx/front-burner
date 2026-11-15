import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { RepositoryDetails } from '@front-burner/shared-contracts';

import { repositoryDetails } from '../../../testing/repository-details';
import { translocoTesting } from '../../../testing/transloco-testing';
import { CloneDetailsComponent } from './clone-details.component';

const KEY = 'web-feature-repositories.CloneDetailsComponent';

describe('CloneDetailsComponent', () => {
  let fixture: ComponentFixture<CloneDetailsComponent>;

  async function show(details: RepositoryDetails): Promise<HTMLElement> {
    await TestBed.configureTestingModule({
      imports: [
        CloneDetailsComponent,
        translocoTesting({
          [`${KEY}.full`]: 'Full clone',
          [`${KEY}.singleBranch`]: 'Single branch: {{ branch }}',
          [`${KEY}.levels.advanced`]: 'Advanced',
          [`${KEY}.descriptions.advanced`]: 'Full control over branches, commits and sync.'
        })
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(CloneDetailsComponent);
    fixture.componentRef.setInput('details', details);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  /** Each label with its value, as the key-value list shows them. */
  function values(host: HTMLElement): Record<string, string> {
    return Object.fromEntries(
      [ ...host.querySelectorAll('div[uikeyvalue]') ].map(item => [
        item.querySelector('dt')?.textContent?.trim(),
        item.querySelector('dd')?.textContent?.replace(/\s+/g, ' ').trim()
      ])
    );
  }

  it('is a section named by its heading', async () => {
    const host = await show(repositoryDetails());

    const section = host.querySelector('section');
    const heading = host.querySelector('h2');
    expect(heading?.textContent?.trim()).toBe(`${KEY}.heading`);
    expect(section?.getAttribute('aria-labelledby')).toBe(heading?.id);
  });

  it('shows a full clone', async () => {
    const host = await show(repositoryDetails());

    expect(values(host)[`${KEY}.cloneMode`]).toBe('Full clone');
  });

  it('shows a single-branch clone with its branch', async () => {
    const host = await show(repositoryDetails({}, { cloneMode: 'single-branch', branch: 'main' }));

    expect(values(host)[`${KEY}.cloneMode`]).toBe('Single branch: main');
  });

  it('shows a single-branch clone without a recorded branch as "Single branch"', async () => {
    const host = await show(repositoryDetails({}, { cloneMode: 'single-branch', branch: null }));

    expect(values(host)[`${KEY}.cloneMode`]).toBe(`${KEY}.singleBranchUnknown`);
  });

  it('shows the git control level with its description', async () => {
    const host = await show(repositoryDetails());

    expect(values(host)[`${KEY}.gitLevel`]).toBe('Advanced Full control over branches, commits and sync.');
  });

  it('shows the day it was added, with the exact time on focus', async () => {
    const host = await show(repositoryDetails({}, { addedAt: '2026-10-25T09:30:00.000Z' }));

    const time = host.querySelector('time');
    expect(time?.getAttribute('datetime')).toBe('2026-10-25T09:30:00.000Z');
    expect(time?.getAttribute('tabindex')).toBe('0');
    expect(time?.textContent).toContain('2026');
  });
});
