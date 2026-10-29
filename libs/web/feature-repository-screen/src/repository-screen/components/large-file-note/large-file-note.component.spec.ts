import { ComponentFixture, TestBed } from '@angular/core/testing';

import { settle } from '../../../testing/settle';
import { translocoTesting } from '../../../testing/transloco-testing';
import { LargeFileNoteComponent } from './large-file-note.component';

const K = 'web-feature-repository-screen.LargeFileNoteComponent';

describe('LargeFileNoteComponent', () => {
  let fixture: ComponentFixture<LargeFileNoteComponent>;

  const note = () => fixture.nativeElement as HTMLElement;

  beforeEach(async () => {
    TestBed.configureTestingModule({ imports: [ LargeFileNoteComponent, translocoTesting() ] });
    fixture = TestBed.createComponent(LargeFileNoteComponent);
    await settle(fixture);
  });

  it('says why highlighting is off, quietly', () => {
    const banner = note().querySelector('ui-inline-banner') as HTMLElement;

    expect(banner.textContent).toContain(`${K}.message`);
    expect(banner.hasAttribute('data-quiet')).toBe(true);
  });

  it('offers Turn on highlighting', () => {
    const emitted: unknown[] = [];
    fixture.componentInstance.turnOn.subscribe(() => emitted.push(true));
    const button = note().querySelector('[uiBannerActions] button') as HTMLButtonElement;

    button.click();

    expect(button.textContent?.trim()).toBe(`${K}.turnOn`);
    expect(emitted).toEqual([ true ]);
  });
});
