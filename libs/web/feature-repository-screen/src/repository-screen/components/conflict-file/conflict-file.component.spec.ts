import { type ComponentFixture, TestBed } from '@angular/core/testing';
import type { GitConflictFile } from '@front-burner/shared-contracts';

import { translocoTesting } from '../../../testing/transloco-testing';
import { ConflictFileComponent } from './conflict-file.component';

const KEY = 'web-feature-repository-screen.ConflictFileComponent';

describe('ConflictFileComponent', () => {
  let fixture: ComponentFixture<ConflictFileComponent>;

  const host = () => fixture.nativeElement as HTMLElement;
  const text = (selector: string) => host().querySelector(selector)?.textContent?.trim();

  async function show(file: Partial<GitConflictFile>): Promise<void> {
    fixture.componentRef.setInput('file', {
      path: 'docs/guide.md',
      kind: 'both-changed',
      resolved: false,
      editable: true,
      edited: false,
      oursSize: 1,
      theirsSize: 1,
      ...file
    });
    await fixture.whenStable();
  }

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [ ConflictFileComponent, translocoTesting() ] });
    fixture = TestBed.createComponent(ConflictFileComponent);
  });

  it('shows the file\'s name, folder, kind and state', async () => {
    await show({});

    expect(text('h2')).toBe('guide.md');
    expect(text('.folder')).toBe('docs');
    expect(text('.kind')).toBe(`${KEY}.both-changed`);
    expect(text('.state')).toBe(`${KEY}.unresolved`);
  });

  it('shows no folder for a file in the root folder, and a resolved file as such', async () => {
    await show({ path: 'a.md', kind: 'deleted-by-them', resolved: true });

    expect(host().querySelector('.folder')).toBeNull();
    expect(text('.kind')).toBe(`${KEY}.deleted-by-them`);
    expect(text('.state')).toBe(`${KEY}.resolved`);
  });
});
