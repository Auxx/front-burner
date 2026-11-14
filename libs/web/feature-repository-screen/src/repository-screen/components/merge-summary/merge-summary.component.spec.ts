import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import type { GitMergeState } from '@front-burner/shared-contracts';
import { TruncatedTooltipDirective } from '@front-burner/ui';

import { settle } from '../../../testing/settle';
import { translocoTesting } from '../../../testing/transloco-testing';
import { MergeSummaryComponent } from './merge-summary.component';

const K = 'web-feature-repository-screen.MergeSummaryComponent';

const merge: GitMergeState = {
  into: 'main',
  from: 'origin/main',
  files: [ true, true, false ].map((resolved, index) => ({
    path: `${index}.md`,
    kind: 'both-changed' as const,
    resolved,
    edited: false,
    editable: true,
    oursSize: 1,
    theirsSize: 1,
    oursShowable: true,
    theirsShowable: true
  })),
  otherFiles: [],
  message: 'Merge'
};

describe('MergeSummaryComponent', () => {
  let fixture: ComponentFixture<MergeSummaryComponent>;
  let aborted: number;

  const host = () => fixture.nativeElement as HTMLElement;
  const text = () => host().textContent?.replace(/\s+/g, ' ').trim();
  const menu = () => document.querySelector('.cdk-overlay-container ui-menu') as HTMLElement | null;
  const barButton = () => host().querySelector('button') as HTMLButtonElement;

  async function show(inputs: { state?: GitMergeState | null; narrow?: boolean; busy?: boolean; } = {}) {
    fixture.componentRef.setInput('state', inputs.state === undefined ? merge : inputs.state);
    fixture.componentRef.setInput('narrow', inputs.narrow ?? false);
    fixture.componentRef.setInput('busy', inputs.busy ?? false);
    await settle(fixture);
  }

  beforeEach(() => {
    aborted = 0;
    TestBed.configureTestingModule({
      imports: [
        MergeSummaryComponent,
        translocoTesting({
          [`${K}.merging`]: 'Merging',
          [`${K}.into`]: 'into',
          [`${K}.resolved`]: '{{ resolved }} of {{ total }} files resolved',
          [`${K}.inProgress`]: 'Merge in progress',
          [`${K}.abort`]: 'Abort merge',
          [`${K}.gitActions`]: 'Git actions',
          [`${K}.gitActionsWarning`]: 'Git actions. {{ warning }}'
        })
      ]
    });
    fixture = TestBed.createComponent(MergeSummaryComponent);
    fixture.componentInstance.abortMerge.subscribe(() => aborted++);
  });

  it('shows what merges into what, and the count', async () => {
    await show();

    expect(text()).toContain('Merging origin/main into main');
    expect(text()).toContain('2 of 3 files resolved');
  });

  it('says a merge is in progress until it has been read, with Abort merge', async () => {
    await show({ state: null });

    expect(text()).toContain('Merge in progress');
    barButton().click();
    expect(aborted).toBe(1);
  });

  it('offers Abort merge in the bar on a wide screen', async () => {
    await show();

    expect(barButton().textContent?.trim()).toBe('Abort merge');
    expect(barButton().getAttribute('aria-haspopup')).toBeNull();

    barButton().click();

    expect(aborted).toBe(1);
  });

  it('shows that an abort is running', async () => {
    await show({ busy: true });

    expect(barButton().getAttribute('data-busy')).toBe('true');
  });

  it('shortens long names on a phone', async () => {
    const long = 'origin/feature/a-very-long-branch-name-indeed';
    await show({ narrow: true, state: { ...merge, from: long, into: 'release/also-quite-long' } });

    const tips = fixture.debugElement
      .queryAll(By.directive(TruncatedTooltipDirective))
      .map(element => element.injector.get(TruncatedTooltipDirective));

    expect(tips.map(tip => tip.text())).toEqual([ long, 'release/also-quite-long' ]);
    expect(tips.every(tip => tip.longPress())).toBe(true);
    expect(tips.every(tip => tip.showOnClick())).toBe(true);
  });

  it('moves Abort merge into the menu on a phone', async () => {
    await show({ narrow: true });

    expect(text()).toContain('2 of 3 files resolved');
    expect(barButton().getAttribute('aria-haspopup')).toBe('menu');
    expect(barButton().getAttribute('aria-label')).toBe('Git actions');
    expect(aborted).toBe(0);

    barButton().click();
    await settle(fixture);
    const item = menu()?.querySelector('button') as HTMLButtonElement;
    expect(item.textContent?.trim()).toBe('Abort merge');

    item.click();
    await settle(fixture);

    expect(aborted).toBe(1);
  });

  it('offers a warning in the menu on a phone, and shows on its button that there is one', async () => {
    await show({ narrow: true });
    let shown = 0;
    fixture.componentInstance.showWarning.subscribe(() => shown++);

    fixture.componentRef.setInput('warning', 'Couldn\'t check');
    await settle(fixture);

    expect(barButton().getAttribute('aria-label')).toBe('Git actions. Couldn\'t check');
    barButton().click();
    await settle(fixture);
    const items = [ ...(menu()?.querySelectorAll('button') ?? []) ] as HTMLButtonElement[];
    expect(items.map(item => item.textContent?.trim())).toEqual([ 'Abort merge', 'Couldn\'t check' ]);

    items[1].click();
    await settle(fixture);

    expect(shown).toBe(1);
    expect(aborted).toBe(0);
  });

  it.each([ false, true ])('takes the focus on its button, on a phone too (%s)', async narrow => {
    await show({ narrow });
    document.body.append(host());

    fixture.componentInstance.focus();

    expect(document.activeElement).toBe(barButton());
    host().remove();
  });
});
