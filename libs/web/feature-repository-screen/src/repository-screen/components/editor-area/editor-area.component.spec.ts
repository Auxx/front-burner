import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { Entry } from '@front-burner/shared-contracts';

import { entry } from '../../../testing/listings';
import { settle } from '../../../testing/settle';
import { translocoTesting } from '../../../testing/transloco-testing';
import { EditorAreaComponent } from './editor-area.component';

const K = 'web-feature-repository-screen.EditorAreaComponent';

describe('EditorAreaComponent', () => {
  let fixture: ComponentFixture<EditorAreaComponent>;

  const area = () => fixture.nativeElement as HTMLElement;

  async function show(path: string | null, shown?: Entry | null): Promise<void> {
    fixture.componentRef.setInput('path', path);
    fixture.componentRef.setInput('entry', shown);
    await settle(fixture);
  }

  beforeEach(async () => {
    TestBed.configureTestingModule({ imports: [ EditorAreaComponent, translocoTesting() ] });
    fixture = TestBed.createComponent(EditorAreaComponent);
    await settle(fixture);
  });

  it('shows the empty state', () => {
    expect(area().querySelector('ui-empty-state .message')?.textContent?.trim()).toBe(`${K}.empty`);
  });

  it('offers New file in the empty state', () => {
    const emitted: unknown[] = [];
    fixture.componentInstance.newFile.subscribe(() => emitted.push(true));

    (area().querySelector('[uiEmptyStateActions] button') as HTMLButtonElement).click();

    expect(area().querySelector('[uiEmptyStateActions] button')?.textContent?.trim()).toBe(`${K}.newFile`);
    expect(emitted).toEqual([ true ]);
  });

  it('shows nothing while the entry is being found', async () => {
    await show('docs/guide.md', undefined);

    expect(area().textContent?.trim()).toBe('');
  });

  it('shows a Markdown file\'s name until the editor exists', async () => {
    await show('docs/guide.md', entry('guide.md'));

    expect(area().querySelector('h2')?.textContent?.trim()).toBe('guide.md');
    expect(area().textContent).toContain(`${K}.later`);
  });

  it('says why another entry cannot be opened', async () => {
    await show('logo.png', entry('logo.png'));

    expect(area().querySelector('rs-entry-message')).not.toBeNull();
    expect(area().textContent).not.toContain(`${K}.later`);
  });

  it('says the open file was deleted or renamed elsewhere', async () => {
    fixture.componentRef.setInput('goneElsewhere', true);
    await show('docs/guide.md', entry('guide.md'));

    expect(area().querySelector('ui-empty-state h2')?.textContent?.trim()).toBe('guide.md');
    expect(area().textContent).toContain(`${K}.goneElsewhere`);
    expect(area().textContent).not.toContain(`${K}.later`);
  });

  it('passes on the actions of the entry message', async () => {
    const emitted: unknown[] = [];
    fixture.componentInstance.action.subscribe(action => emitted.push(action));

    await show('docs/logo.png', entry('logo.png'));
    (area().querySelector('rs-entry-message button') as HTMLButtonElement).click();

    expect(emitted).toEqual([ 'delete' ]);
  });
});
