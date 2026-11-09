import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import type { GitStatus } from '@front-burner/shared-contracts';
import { TruncatedTooltipDirective } from '@front-burner/ui';

import { settle } from '../../../testing/settle';
import { translocoTesting } from '../../../testing/transloco-testing';
import { GitStatusSummaryComponent } from './git-status-summary.component';

const K = 'web-feature-repository-screen.GitStatusSummaryComponent';

const published: GitStatus = {
  branch: 'main',
  noCommits: false,
  lastCommit: null,
  upstream: 'origin/main',
  upstreamGone: false,
  sameNameRemote: false,
  ahead: 0,
  behind: 0,
  changes: [],
  mergeInProgress: false,
  networkJob: null,
  fetchProblem: null
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
          [`${K}.noBranch`]: 'No branch',
          [`${K}.openList`]: 'Branch {{ branch }}: open the branch list',
          [`${K}.openListNoBranch`]: 'No branch: open the branch list'
        })
      ]
    });
    fixture = TestBed.createComponent(GitStatusSummaryComponent);
  });

  it('says that a switch is on its way, in the button and to screen readers', async () => {
    const button = () => host().querySelector('button') as HTMLButtonElement;
    const live = () => host().querySelector('[aria-live]');
    await show(published);
    expect(button().textContent).toBe('main');
    expect(button().getAttribute('aria-disabled')).toBeNull();
    expect(live()?.textContent).toBe('');

    fixture.componentRef.setInput('switching', true);
    await settle(fixture);

    expect(button().textContent).toBe(`${K}.switching`);
    expect(button().getAttribute('aria-label')).toBe(`${K}.switching`);
    expect(button().getAttribute('aria-disabled')).toBe('true');
    expect(button().disabled).toBe(false);
    expect(live()?.textContent).toBe(`${K}.switching`);
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

  describe('a branch too long for the bar', () => {
    const branch = 'feature/'.repeat(25);
    const tooltip = () =>
      fixture.debugElement.query(By.directive(TruncatedTooltipDirective)).injector.get(TruncatedTooltipDirective);

    beforeEach(() => {
      // No layout in jsdom: a name is shortened when it is long. The end-to-end
      // test checks the width on a phone.
      vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function(this: HTMLElement) {
        return (this.textContent?.length ?? 0) * 10;
      });
      vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(100);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('shortens a long name, with the full name on hover, focus or long press', async () => {
      await show({ ...published, branch });

      expect(tooltip().text()).toBe(branch);
      expect(tooltip().truncated()).toBe(true);
      expect(tooltip().longPress()).toBe(true);
      // A tap opens the list, so it can't show the tooltip too.
      expect(tooltip().showOnClick()).toBe(false);
    });

    it('has no tooltip for a branch that fits', async () => {
      await show(published);

      expect(tooltip().truncated()).toBe(false);
    });

    it('keeps nothing of a long branch after a detached HEAD', async () => {
      await show({ ...published, branch });
      await show({ ...published, branch: null, upstream: null });
      await show(published);

      expect(tooltip().truncated()).toBe(false);
    });
  });

  describe('the button', () => {
    const button = () => host().querySelector('button') as HTMLButtonElement;

    it('opens the list from the branch', async () => {
      const opened = vi.fn();
      fixture.componentInstance.openBranches.subscribe(opened);
      await show(published);

      button().click();

      expect(opened).toHaveBeenCalledOnce();
    });

    it('says in its name what it does', async () => {
      await show(published);

      expect(button().textContent?.trim()).toBe('main');
      expect(button().getAttribute('aria-label')).toBe('Branch main: open the branch list');
    });

    it('opens the list without a branch too, as that is the way back', async () => {
      const opened = vi.fn();
      fixture.componentInstance.openBranches.subscribe(opened);
      await show({ ...published, branch: null, upstream: null });

      expect(button().textContent?.trim()).toBe('No branch');
      expect(button().getAttribute('aria-label')).toBe('No branch: open the branch list');

      button().click();

      expect(opened).toHaveBeenCalledOnce();
    });

    it('stays the same element when the branch goes away, so that it keeps the focus', async () => {
      await show(published);
      const before = button();

      await show({ ...published, branch: null, upstream: null });

      expect(button()).toBe(before);
    });

    it('leaves the counts out of the button', async () => {
      await show({ ...published, ahead: 2 });

      expect(button().textContent).not.toContain('to push');
    });

    it('is not there until the status has loaded', async () => {
      await show(null);

      expect(host().querySelector('button')).toBeNull();
    });
  });
});
