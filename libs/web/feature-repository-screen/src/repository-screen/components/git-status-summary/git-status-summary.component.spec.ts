import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import type { GitStatus } from '@front-burner/shared-contracts';
import { TooltipDirective } from '@front-burner/ui';

import { settle } from '../../../testing/settle';
import { translocoTesting } from '../../../testing/transloco-testing';
import { GitStatusSummaryComponent } from './git-status-summary.component';

const K = 'web-feature-repository-screen.GitStatusSummaryComponent';

const published: GitStatus = {
  branch: 'main',
  noCommits: false,
  upstream: 'origin/main',
  ahead: 0,
  behind: 0,
  changes: [],
  mergeInProgress: false
};

describe('GitStatusSummaryComponent', () => {
  let fixture: ComponentFixture<GitStatusSummaryComponent>;

  const host = () => fixture.nativeElement as HTMLElement;
  const text = () => host().textContent?.replace(/\s+/g, ' ').trim();

  async function show(status: GitStatus | null): Promise<void> {
    fixture.componentRef.setInput('status', status);
    await settle(fixture);
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [
        GitStatusSummaryComponent,
        translocoTesting({
          [`${K}.toPush`]: '{{ ahead }} to push',
          [`${K}.toPull`]: '{{ behind }} to pull',
          [`${K}.toPushAndPull`]: '{{ ahead }} to push, {{ behind }} to pull',
          [`${K}.notPublished`]: 'Not published',
          [`${K}.noCommits`]: 'no commits yet',
          [`${K}.noBranch`]: 'No branch'
        })
      ]
    });
    fixture = TestBed.createComponent(GitStatusSummaryComponent);
  });

  it('shows the branch and 2 to push, 3 to pull', async () => {
    await show({ ...published, ahead: 2, behind: 3 });

    expect(text()).toBe('main · 2 to push, 3 to pull');
  });

  it.each([
    [ 2, 0, 'main · 2 to push' ],
    [ 0, 3, 'main · 3 to pull' ]
  ])('shows only the count that is not zero: %i to push, %i to pull', async (ahead, behind, shown) => {
    await show({ ...published, ahead, behind });

    expect(text()).toBe(shown);
  });

  it('shows nothing for the counts when both are zero', async () => {
    await show(published);

    expect(text()).toBe('main');
    expect(host().querySelector('.separator')).toBeNull();
  });

  it('shows Not published for a branch without an upstream', async () => {
    await show({ ...published, branch: 'notes', upstream: null });

    expect(text()).toBe('notes · Not published');
  });

  it('shows main · no commits yet', async () => {
    await show({ ...published, upstream: null, noCommits: true });

    expect(text()).toBe('main · no commits yet');
    expect(text()).not.toContain('Not published');
  });

  it('shows nothing until the status has loaded', async () => {
    await show(null);

    expect(text()).toBe('');
  });

  it('shows No branch for a detached HEAD', async () => {
    await show({ ...published, branch: null, upstream: null });

    expect(text()).toBe('No branch');
  });

  it('keeps the separator out of what is read aloud', async () => {
    await show({ ...published, ahead: 1 });

    expect(host().querySelector('.separator')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('puts the full name of a shortened branch in a tooltip that a tap or long press shows', async () => {
    const branch = 'feature/'.repeat(25);
    await show({ ...published, branch });
    const element = host().querySelector('.branch') as HTMLElement;
    // No layout in the test environment: the end-to-end test checks the width on a phone.
    Object.defineProperty(element, 'scrollWidth', { value: 500 });
    Object.defineProperty(element, 'clientWidth', { value: 100 });
    await show({ ...published, branch, ahead: 1 });

    const tooltip = fixture.debugElement.query(By.directive(TooltipDirective));
    expect(tooltip.nativeElement).toBe(element);
    expect(tooltip.injector.get(TooltipDirective).text()).toBe(branch);
    expect(tooltip.injector.get(TooltipDirective).longPress()).toBe(true);
    expect(element.getAttribute('tabindex')).toBe('0');
  });

  it('has no tooltip for a branch that fits', async () => {
    await show(published);

    const element = host().querySelector('.branch') as HTMLElement;
    expect(fixture.debugElement.query(By.directive(TooltipDirective)).injector.get(TooltipDirective).text())
      .toBe('');
    expect(element.getAttribute('tabindex')).toBeNull();
  });
});
