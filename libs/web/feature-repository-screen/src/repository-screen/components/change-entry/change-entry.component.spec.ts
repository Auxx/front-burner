import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import type { GitChange } from '@front-burner/shared-contracts';
import { TooltipDirective } from '@front-burner/ui';

import { translocoTesting } from '../../../testing/transloco-testing';
import { ChangeEntryComponent } from './change-entry.component';

const KEY = 'web-feature-repository-screen.ChangeEntryComponent';

describe('ChangeEntryComponent', () => {
  let fixture: ComponentFixture<ChangeEntryComponent>;

  const host = () => fixture.nativeElement as HTMLElement;
  const entry = () => host().querySelector('button') as HTMLButtonElement;
  const text = (selector: string) => host().querySelector(selector)?.textContent?.trim();

  async function show(change: GitChange, selected = false): Promise<void> {
    fixture.componentRef.setInput('change', change);
    fixture.componentRef.setInput('selected', selected);
    await fixture.whenStable();
  }

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [ ChangeEntryComponent, translocoTesting() ] });
    fixture = TestBed.createComponent(ChangeEntryComponent);
  });

  it('shows the file name and, apart from it, its folder', async () => {
    await show({ path: 'docs/api/index.md', state: 'modified' });

    expect(text('.name')).toBe('index.md');
    expect(text('.folder')).toBe('docs/api');
  });

  it('shows no folder for a file in the root folder', async () => {
    await show({ path: 'README.md', state: 'modified' });

    expect(text('.name')).toBe('README.md');
    expect(host().querySelector('.folder')).toBeNull();
  });

  it.each(
    [
      [ 'modified', 'warning' ],
      [ 'added', 'success' ],
      [ 'deleted', 'danger' ]
    ] as const
  )('shows each state in words and with a letter: %s', async (state, status) => {
    await show({ path: 'README.md', state });

    expect(text('.word')).toBe(`${KEY}.${state}`);
    expect(text('.letter')).toBe(`${KEY}.${state}Letter`);
    // The letter repeats the word for the eye; the colour repeats them both (NF-13.7).
    expect(host().querySelector('.letter')?.getAttribute('aria-hidden')).toBe('true');
    expect(host().querySelector('.letter')?.getAttribute('data-status')).toBe(status);
  });

  it('shortens a long path, with the whole path available', async () => {
    const path = `${'very-long-folder-name/'.repeat(20)}file.md`;
    await show({ path, state: 'added' });

    const tooltip = fixture.debugElement.query(By.directive(TooltipDirective));
    expect(tooltip.nativeElement).toBe(entry());
    expect(tooltip.injector.get(TooltipDirective).text()).toBe(path);
    // Shortened by the style sheet; the end-to-end test checks the width on a phone.
    expect(host().querySelector('.name')).not.toBeNull();
    expect(host().querySelector('.folder')).not.toBeNull();
  });

  it('asks for its path when selected', async () => {
    await show({ path: 'docs/guide.md', state: 'deleted' });
    const selected: string[] = [];
    fixture.componentInstance.selectPath.subscribe(path => selected.push(path));

    entry().click();

    expect(selected).toEqual([ 'docs/guide.md' ]);
  });

  it('offers Discard, named after the file, without selecting the entry', async () => {
    await show({ path: 'docs/guide.md', state: 'modified' });
    const selected: string[] = [];
    const discarded: GitChange[] = [];
    fixture.componentInstance.selectPath.subscribe(path => selected.push(path));
    fixture.componentInstance.discard.subscribe(change => discarded.push(change));

    const discard = host().querySelector('.discard') as HTMLButtonElement;
    expect(discard.getAttribute('aria-label')).toBe(`${KEY}.discard`);
    discard.click();

    expect(discarded).toEqual([ { path: 'docs/guide.md', state: 'modified' } ]);
    expect(selected).toEqual([]);
  });

  it('marks the selected entry, not only with a colour', async () => {
    await show({ path: 'README.md', state: 'added' });
    expect(entry().getAttribute('aria-current')).toBeNull();

    await show({ path: 'README.md', state: 'added' }, true);
    expect(entry().getAttribute('aria-current')).toBe('true');
  });
});
