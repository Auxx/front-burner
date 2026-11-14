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
  let committed: number;

  const host = () => fixture.nativeElement as HTMLElement;
  const text = () => host().textContent?.replace(/\s+/g, ' ').trim();
  const menu = () => document.querySelector('.cdk-overlay-container ui-menu') as HTMLElement | null;
  const barButton = () => host().querySelector('button') as HTMLButtonElement;
  const abortButton = () => host().querySelector('button.abort') as HTMLButtonElement;
  const commitButton = () => host().querySelector('button.commit') as HTMLButtonElement;
  const menuItems = () => [ ...(menu()?.querySelectorAll('button') ?? []) ] as HTMLButtonElement[];

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
          [`${K}.commit`]: 'Commit merge',
          [`${K}.resolveFirst`]: 'Resolve every file first',
          [`${K}.gitActions`]: 'Git actions',
          [`${K}.gitActionsWarning`]: 'Git actions. {{ warning }}'
        })
      ]
    });
    fixture = TestBed.createComponent(MergeSummaryComponent);
    fixture.componentInstance.abortMerge.subscribe(() => aborted++);
    committed = 0;
    fixture.componentInstance.commit.subscribe(() => committed++);
  });

  it('shows what merges into what, and the count', async () => {
    await show();

    expect(text()).toContain('Merging origin/main into main');
    expect(text()).toContain('2 of 3 files resolved');
  });

  it('says only that a merge is in progress until it has been read, with Abort merge', async () => {
    await show({ state: null });

    expect(text()).toContain('Merge in progress');
    expect(commitButton()).toBeNull();
    expect(text()).not.toContain('Resolve every file first');
    abortButton().click();
    expect(aborted).toBe(1);
  });

  it('offers nothing but Abort merge in the menu on a phone until the merge has been read', async () => {
    await show({ state: null, narrow: true });
    barButton().click();
    await settle(fixture);

    expect(menuItems().map(item => item.textContent?.trim())).toEqual([ 'Abort merge' ]);
  });

  it('keeps the focus on Commit merge when the last file is resolved, also elsewhere', async () => {
    await show();
    document.body.append(host());
    const button = commitButton();
    button.focus();

    await show({ state: { ...merge, files: merge.files.map(file => ({ ...file, resolved: true })) } });

    expect(commitButton()).toBe(button);
    expect(document.activeElement).toBe(button);
    expect(button.getAttribute('aria-disabled')).toBeNull();
    host().remove();
  });

  it('is unavailable while an abort runs', async () => {
    const ready = { ...merge, files: merge.files.map(file => ({ ...file, resolved: true })) };
    await show({ state: ready, busy: true });

    expect(commitButton().getAttribute('aria-disabled')).toBe('true');
    commitButton().click();
    expect(committed).toBe(0);

    await show({ state: ready, busy: true, narrow: true });
    barButton().click();
    await settle(fixture);
    expect(menuItems()[0].textContent).toContain('Commit merge');
    expect(menuItems()[0].getAttribute('aria-disabled') ?? menuItems()[0].disabled.toString()).toMatch(/true/);
  });

  it('offers Abort merge in the bar on a wide screen', async () => {
    await show();

    expect(abortButton().textContent?.trim()).toBe('Abort merge');
    expect(abortButton().getAttribute('aria-haspopup')).toBeNull();

    abortButton().click();

    expect(aborted).toBe(1);
  });

  it('shows that an abort is running', async () => {
    await show({ busy: true });

    expect(abortButton().getAttribute('data-busy')).toBe('true');
  });

  it('is unavailable until every file is resolved, with the reason', async () => {
    await show();

    expect(commitButton().textContent?.trim()).toBe('Commit merge');
    expect(commitButton().getAttribute('aria-disabled')).toBe('true');
    expect(commitButton().getAttribute('aria-description') ?? commitButton().getAttribute('aria-describedby'))
      .not.toBeNull();
    commitButton().click();
    await settle(fixture);
    expect(committed).toBe(0);
    expect(document.body.textContent).toContain('Resolve every file first');

    await show({ state: { ...merge, files: merge.files.map(file => ({ ...file, resolved: true })) } });
    expect(commitButton().getAttribute('aria-disabled')).toBeNull();
    commitButton().click();

    expect(committed).toBe(1);
  });

  it('is ready at once with no conflicting file left', async () => {
    await show({ state: { ...merge, files: [] } });

    commitButton().click();

    expect(committed).toBe(1);
  });

  it('offers Commit merge in the menu on a phone, with its reason until it is ready', async () => {
    await show({ narrow: true });
    barButton().click();
    await settle(fixture);

    expect(menuItems()[0].textContent).toContain('Commit merge');
    expect(menuItems()[0].textContent).toContain('Resolve every file first');
    expect(menuItems()[0].getAttribute('aria-disabled') ?? menuItems()[0].disabled.toString()).toMatch(/true/);
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
    const item = menuItems()[1];
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
    const items = menuItems();
    expect(items.slice(1).map(item => item.textContent?.trim())).toEqual([ 'Abort merge', 'Couldn\'t check' ]);

    items[2].click();
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
