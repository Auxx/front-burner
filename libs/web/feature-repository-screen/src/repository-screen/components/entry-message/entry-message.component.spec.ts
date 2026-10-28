import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { Entry } from '@front-burner/shared-contracts';

import { entry, folder } from '../../../testing/listings';
import { settle } from '../../../testing/settle';
import { translocoTesting } from '../../../testing/transloco-testing';
import { EntryMessageComponent } from './entry-message.component';

const K = 'web-feature-repository-screen.EntryMessageComponent';

@Component({
  imports: [ EntryMessageComponent ],
  template: `<rs-entry-message [entry]="entry()" [path]="path()" />`
})
class HostComponent {
  readonly entry = signal<Entry | null>(null);
  readonly path = signal('docs/nope.md');
}

describe('EntryMessageComponent', () => {
  let fixture: ComponentFixture<HostComponent>;

  const heading = () => (fixture.nativeElement as HTMLElement).querySelector('h2')?.textContent?.trim();
  const message = () => (fixture.nativeElement as HTMLElement).querySelector('.message')?.textContent?.trim();

  async function show(path: string, shown: Entry | null): Promise<void> {
    fixture.componentInstance.path.set(path);
    fixture.componentInstance.entry.set(shown);
    await settle(fixture);
  }

  beforeEach(async () => {
    TestBed.configureTestingModule({ imports: [ HostComponent, translocoTesting() ] });
    fixture = TestBed.createComponent(HostComponent);
    await settle(fixture);
  });

  it('says a missing path does not exist (FB-13)', async () => {
    await show('docs/nope.md', null);

    expect(heading()).toBe('nope.md');
    expect(message()).toBe(`${K}.missing`);
  });

  it.each([
    [ 'docs/logo.png', entry('logo.png'), 'nonMarkdown' ],
    [ 'latest', entry('latest', { kind: 'symlink', size: null }), 'symlink' ],
    [ 'vendor/lib', entry('lib', { kind: 'submodule', size: null }), 'submodule' ],
    [ 'docs', folder('docs'), 'nonMarkdown' ]
  ])('names %s and says why it cannot be opened', async (path, shown, key) => {
    await show(path, shown);

    expect(heading()).toBe(path.slice(path.lastIndexOf('/') + 1));
    expect(message()).toBe(`${K}.${key}`);
  });
});
